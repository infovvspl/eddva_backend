import { Injectable, Logger } from '@nestjs/common';
import { S3Service } from '../../upload/s3.service';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import ffmpegPath from 'ffmpeg-static';
import * as ffprobeInstaller from '@ffprobe-installer/ffprobe';
// fluent-ffmpeg is an `export =` module whose value is itself callable
// (ffmpeg(input)) AND carries the static setters — import= keeps both.
import ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath((ffmpegPath as unknown as string) || (ffmpegPath as any));
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export interface TranscodeResult {
  webUrl: string;
  webKey: string;
  sizeBytes: number;
}

/**
 * Compresses uploaded lecture videos to a web-friendly MP4.
 *
 * Teacher uploads are stored raw — a 720p clip can be 260 MB+ at ~50 Mbps, far
 * above any streaming bitrate, so playback buffers badly regardless of caching.
 * This transcodes to ~720p H.264 @ ~2 Mbps + faststart (typically an 8–10×
 * reduction), which is the real fix for slow playback. The original is kept.
 *
 * Runs ffmpeg as a child process (never blocks the event loop) and serialises
 * transcodes with a small semaphore so a big job can't starve the live app.
 */
@Injectable()
export class TranscodeService {
  private readonly logger = new Logger(TranscodeService.name);

  // Serialise CPU-heavy transcodes across the whole process. One at a time keeps
  // ffmpeg from competing with request handling on a shared box; raise only on a
  // dedicated worker.
  private static readonly MAX_CONCURRENT = Number(process.env.TRANSCODE_MAX_CONCURRENT || 1);
  private static active = 0;
  private static readonly waiters: Array<() => void> = [];

  // Hard ceiling so a pathological input can't pin a core forever.
  private static readonly TIMEOUT_MS = Number(process.env.TRANSCODE_TIMEOUT_MS || 45 * 60 * 1000);

  private async acquire(): Promise<void> {
    if (TranscodeService.active >= TranscodeService.MAX_CONCURRENT) {
      await new Promise<void>((res) => TranscodeService.waiters.push(res));
    }
    TranscodeService.active++;
  }

  private release(): void {
    TranscodeService.active--;
    const next = TranscodeService.waiters.shift();
    if (next) next();
  }

  private async ffmpegAvailable(): Promise<boolean> {
    try {
      const { execSync } = await import('child_process');
      execSync(`"${ffprobeInstaller.path}" -version`, { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch (err: any) {
      this.logger.warn(`ffmpeg/ffprobe not available — skipping transcode: ${err?.message}`);
      return false;
    }
  }

  private webKeyFor(originalKey: string): string {
    // tenants/.../foo.mp4 -> tenants/.../foo-web.mp4  (stable, alongside the original)
    return originalKey.replace(/\.[^./]+$/, '') + '-web.mp4';
  }

  private fsKeyFor(originalKey: string): string {
    return originalKey.replace(/\.[^./]+$/, '') + '-fs.mp4';
  }

  /**
   * Is the moov atom near the front (faststart)? Reads only the first 256 KB, so
   * an already-optimised file is detected without downloading it. A non-faststart
   * MP4 keeps its moov index at the very end, forcing the browser to fetch almost
   * the whole file before playback starts — the real cause of "takes time to play".
   */
  private async isFaststart(videoUrl: string, key: string): Promise<boolean> {
    try {
      let url = videoUrl;
      try { url = await this.s3Service.presignGet(key, 600); } catch { /* use as-is */ }
      const res = await fetch(url, { headers: { Range: 'bytes=0-262143' }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return true; // can't tell → don't churn
      const buf = Buffer.from(await res.arrayBuffer());
      const moov = buf.indexOf('moov');
      const mdat = buf.indexOf('mdat');
      if (moov === -1) return false;                 // moov not in first 256 KB → it's at the end
      return mdat === -1 || moov < mdat;             // moov before mdat → already faststart
    } catch {
      return true;                                   // on error, assume ok (don't reprocess)
    }
  }

  /**
   * Relocate the moov atom to the front (-c copy -movflags +faststart) so playback
   * starts immediately. No re-encoding — it's a container rewrite, so it's CPU-light
   * (fine on a burstable box, unlike full transcode). Returns the new key/url/size,
   * or null when the file is already faststart (skipped) or ffmpeg is unavailable.
   */
  async remuxFaststart(videoUrl: string, videoKey: string | null): Promise<TranscodeResult | null> {
    if (!(await this.ffmpegAvailable())) return null;
    const key = videoKey || this.s3Service.keyFromUrl(videoUrl);
    if (!key) return null;
    if (await this.isFaststart(videoUrl, key)) return null;

    const fsKey = this.fsKeyFor(key);
    const tmpDir = path.join(os.tmpdir(), `eddva-faststart-${randomUUID()}`);
    const inPath = path.join(tmpDir, 'in.mp4');
    const outPath = path.join(tmpDir, 'out.mp4');

    await this.acquire();
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      await this.download(videoUrl, key, inPath);
      await this.runRemux(inPath, outPath);
      if (!fs.existsSync(outPath)) throw new Error('Faststart output was not produced');
      const size = fs.statSync(outPath).size;
      if (size < 1024) throw new Error(`Faststart output too small (${size}B)`);
      // Stream from disk (never buffer the whole file — would OOM a small process).
      const url = await this.s3Service.uploadFile(fsKey, outPath, 'video/mp4');
      await this.s3Service.setCacheControl(fsKey).catch(() => undefined);
      this.logger.log(`Faststart remuxed ${key} -> ${fsKey} (${(size / 1e6).toFixed(1)}MB)`);
      return { webUrl: url, webKey: fsKey, sizeBytes: size };
    } finally {
      this.release();
      this.cleanup(tmpDir);
    }
  }

  private runRemux(inPath: string, outPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(inPath)
        .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
        .on('end', () => resolve())
        .on('error', (err: any) => reject(new Error(`ffmpeg remux failed: ${err?.message}`)));
      const timer = setTimeout(() => {
        try { cmd.kill('SIGKILL'); } catch { /* gone */ }
        reject(new Error('ffmpeg remux timed out'));
      }, 10 * 60 * 1000);
      cmd.on('end', () => clearTimeout(timer)).on('error', () => clearTimeout(timer));
      cmd.save(outPath);
    });
  }

  /**
   * Download → transcode → upload. Returns the web MP4's key/url/size, or null
   * when transcoding is unavailable or not worthwhile. Throws only on real
   * failure so the caller can mark the recording's transcode_status='failed'.
   */
  async transcode(videoUrl: string, videoKey: string | null, instituteId: string): Promise<TranscodeResult | null> {
    if (!(await this.ffmpegAvailable())) return null;

    const key = videoKey || this.s3Service.keyFromUrl(videoUrl);
    if (!key) {
      this.logger.warn('Transcode skipped: could not resolve object key from video URL');
      return null;
    }
    const webKey = this.webKeyFor(key);

    const tmpDir = path.join(os.tmpdir(), `eddva-transcode-${randomUUID()}`);
    const inPath = path.join(tmpDir, 'in.mp4');
    const outPath = path.join(tmpDir, 'out.mp4');

    await this.acquire();
    try {
      fs.mkdirSync(tmpDir, { recursive: true });

      // Stream the source to disk — never buffer a multi-GB upload into memory.
      await this.download(videoUrl, key, inPath);
      const inSize = fs.statSync(inPath).size;

      await this.runFfmpeg(inPath, outPath);

      if (!fs.existsSync(outPath)) throw new Error('Transcoded file was not produced');
      const outSize = fs.statSync(outPath).size;
      if (outSize < 1024) throw new Error(`Transcoded file too small (${outSize}B)`);

      // If compression barely helped (already web-optimised), keep the original.
      if (outSize >= inSize * 0.95) {
        this.logger.log(
          `Transcode gave no meaningful reduction (${inSize}B -> ${outSize}B) — keeping original`,
        );
        return null;
      }

      // Output is small (~tens of MB); a single PUT is fine here.
      const buffer = fs.readFileSync(outPath);
      const webUrl = await this.s3Service.upload(webKey, buffer, 'video/mp4');
      await this.s3Service.setCacheControl(webKey).catch(() => undefined);

      this.logger.log(
        `Transcoded ${key}: ${(inSize / 1e6).toFixed(1)}MB -> ${(outSize / 1e6).toFixed(1)}MB`,
      );
      return { webUrl, webKey, sizeBytes: outSize };
    } finally {
      this.release();
      this.cleanup(tmpDir);
    }
  }

  private async download(videoUrl: string, key: string, destPath: string): Promise<void> {
    // Prefer a fresh presigned GET from the key (public URLs may be uncached/rate
    // limited); fall back to the stored URL if it is already a full URL.
    let url = videoUrl;
    try {
      url = await this.s3Service.presignGet(key, 1800);
    } catch {
      /* fall back to videoUrl */
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(destPath));
    if (fs.statSync(destPath).size < 1024) throw new Error('Downloaded video is too small');
  }

  private runFfmpeg(inPath: string, outPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(inPath)
        .outputOptions([
          // Cap height at 720p, keep aspect; width -2 keeps it even (yuv420p needs it).
          // Never upscales: min(720,ih) leaves smaller sources untouched.
          '-vf', "scale=-2:'min(720,ih)'",
          '-c:v', 'libx264',
          '-preset', 'veryfast',        // fast encode — this runs on the app server
          '-crf', '26',                 // visually fine for lecture content
          '-maxrate', '2500k',
          '-bufsize', '5000k',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',    // moov at front → instant start
        ])
        .on('end', () => resolve())
        .on('error', (err: any) => reject(new Error(`ffmpeg failed: ${err?.message}`)));

      const timer = setTimeout(() => {
        try { cmd.kill('SIGKILL'); } catch { /* already gone */ }
        reject(new Error(`ffmpeg timed out after ${TranscodeService.TIMEOUT_MS}ms`));
      }, TranscodeService.TIMEOUT_MS);

      cmd.on('end', () => clearTimeout(timer)).on('error', () => clearTimeout(timer));
      cmd.save(outPath);
    });
  }

  private cleanup(dir: string): void {
    try {
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
        fs.rmdirSync(dir);
      }
    } catch { /* best-effort */ }
  }

  constructor(private readonly s3Service: S3Service) {}
}
