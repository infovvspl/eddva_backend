import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Service } from '../../upload/s3.service';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import ffmpegPath from 'ffmpeg-static';
import * as ffprobeInstaller from '@ffprobe-installer/ffprobe';
import * as ffmpeg from 'fluent-ffmpeg';

// Configure fluent-ffmpeg to use packaged binaries
ffmpeg.setFfmpegPath(ffmpegPath as string || ffmpegPath);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

/**
 * Video thumbnail generation service using FFmpeg.
 *
 * Extracts a frame at ~5 seconds from an uploaded video, converts to WebP,
 * and uploads to S3. Also probes video metadata (duration, resolution).
 *
 * Uses self-contained @ffmpeg-installer and @ffprobe-installer packages.
 */
@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);
  private ffmpegAvailable: boolean | null = null;

  constructor(
    private readonly s3Service: S3Service,
    private readonly config: ConfigService,
  ) {}

  /**
   * Check if FFmpeg is available on the system.
   * Caches the result after first check.
   */
  private async checkFfmpeg(): Promise<boolean> {
    if (this.ffmpegAvailable !== null) return this.ffmpegAvailable;
    try {
      const { execSync } = await import('child_process');
      execSync(`"${ffprobeInstaller.path}" -version`, { stdio: 'ignore', timeout: 5000 });
      this.ffmpegAvailable = true;
      this.logger.log('FFmpeg/FFprobe package detected — automatic thumbnail generation enabled');
    } catch (err: any) {
      this.ffmpegAvailable = false;
      this.logger.warn(`FFmpeg/FFprobe package check failed: ${err?.message} — automatic thumbnail generation disabled.`);
    }
    return this.ffmpegAvailable;
  }

  /**
   * Generate a thumbnail from a video URL and upload it to S3.
   *
   * @returns Thumbnail metadata or null if generation failed.
   */
  async generateThumbnail(
    videoUrl: string,
    recordingId: string,
    instituteId: string,
  ): Promise<{
    thumbnailUrl: string;
    duration: string;
    resolution: string;
    videoSize: number | null;
  } | null> {
    if (!(await this.checkFfmpeg())) return null;

    const tmpDir = path.join(os.tmpdir(), `eddva-thumb-${randomUUID()}`);
    const tmpVideoPath = path.join(tmpDir, 'input.mp4');
    const tmpThumbPath = path.join(tmpDir, 'thumb.webp');

    try {
      fs.mkdirSync(tmpDir, { recursive: true });

      // Step 1: Download the video to a temp file. Some MP4s keep metadata at
      // the end, so an initial byte range can look like corrupt video to ffmpeg.
      await this.downloadVideo(videoUrl, tmpVideoPath);

      // Step 2: Probe the video for metadata
      const metadata = await this.probeVideo(tmpVideoPath);

      // Step 3: Extract a frame at ~5 seconds and convert to WebP
      await this.extractFrame(tmpVideoPath, tmpThumbPath, 5);

      // Step 4: Read the thumbnail and upload to S3
      if (!fs.existsSync(tmpThumbPath)) {
        throw new Error('Thumbnail file was not created');
      }

      const thumbBuffer = fs.readFileSync(tmpThumbPath);
      if (thumbBuffer.length < 1024) {
        throw new Error(`Thumbnail too small (${thumbBuffer.length}B)`);
      }

      const s3Key = `tenants/${instituteId}/class-recording-thumbnails/${recordingId}.webp`;
      const thumbnailUrl = await this.s3Service.upload(s3Key, thumbBuffer, 'image/webp');

      const durationMins = metadata.durationSeconds
        ? (metadata.durationSeconds / 60).toFixed(1)
        : null;

      this.logger.log(
        `Thumbnail generated for recording ${recordingId}: ${thumbBuffer.length}B, ` +
        `duration=${durationMins}min, resolution=${metadata.resolution}`,
      );

      return {
        thumbnailUrl,
        duration: durationMins || '',
        resolution: metadata.resolution || '',
        videoSize: metadata.fileSize,
      };
    } catch (err: any) {
      this.logger.warn(`Thumbnail generation failed for recording ${recordingId}: ${err?.message}`);
      throw err;
    } finally {
      // Cleanup temp files
      this.cleanupTmp(tmpDir);
    }
  }

  /**
   * Download a video from a URL (or presigned S3 URL) to a local temp file.
   * Downloads the full file because non-fast-start MP4s need tail metadata.
   */
  private async downloadVideo(url: string, destPath: string): Promise<void> {
    // If the URL is an S3 key (not a full URL), presign it first
    let downloadUrl = url;
    if (!url.startsWith('http')) {
      downloadUrl = await this.s3Service.presignGet(url, 300);
    }

    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });

    if (!response.ok) {
      throw new Error(`Failed to download video: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) {
      throw new Error(`Downloaded video is too small (${buffer.length}B)`);
    }
    fs.writeFileSync(destPath, buffer);
  }

  /**
   * Probe a video file for metadata using ffprobe.
   */
  private async probeVideo(filePath: string): Promise<{
    durationSeconds: number | null;
    resolution: string;
    fileSize: number | null;
  }> {
    try {
      return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err: any, data: any) => {
          if (err) {
            this.logger.warn(`ffprobe failed: ${err?.message}`);
            resolve({ durationSeconds: null, resolution: '', fileSize: null });
            return;
          }

          const videoStream = data?.streams?.find((s: any) => s.codec_type === 'video');
          const durationSeconds = data?.format?.duration
            ? parseFloat(data.format.duration)
            : null;
          const width = videoStream?.width || 0;
          const height = videoStream?.height || 0;
          const resolution = width && height ? `${width}x${height}` : '';
          const fileSize = data?.format?.size ? parseInt(data.format.size, 10) : null;

          resolve({ durationSeconds, resolution, fileSize });
        });
      });
    } catch (err: any) {
      this.logger.warn(`ffprobe run failed: ${err?.message}`);
      return { durationSeconds: null, resolution: '', fileSize: null };
    }
  }

  /**
   * Extract a single frame from a video at the given timestamp and save as WebP.
   */
  private async extractFrame(
    inputPath: string,
    outputPath: string,
    timestampSeconds: number,
  ): Promise<void> {
    const { execSync } = await import('child_process');

    // Use ffmpeg directly for reliability:
    // -ss: seek to timestamp
    // -vframes 1: capture one frame
    // -vf scale: cap width at 640px, maintain aspect ratio
    // -c:v libwebp: encode as WebP
    // -quality 80: good quality, small size
    const cmd = [
      `"${ffmpegPath}"`,
      '-y',                          // overwrite output
      '-ss', String(timestampSeconds),
      '-i', `"${inputPath}"`,
      '-vframes', '1',
      '-vf', '"scale=640:-1"',
      '-c:v', 'libwebp',
      '-quality', '80',
      `"${outputPath}"`,
    ].join(' ');

    try {
      execSync(cmd, { stdio: 'ignore', timeout: 30000 });
    } catch {
      // If WebP encoding fails (libwebp not compiled in), try JPEG fallback
      this.logger.warn('WebP encoding failed, trying JPEG fallback');
      const jpegPath = outputPath.replace('.webp', '.jpg');
      const fallbackCmd = [
        `"${ffmpegPath}"`,
        '-y',
        '-ss', String(timestampSeconds),
        '-i', `"${inputPath}"`,
        '-vframes', '1',
        '-vf', '"scale=640:-1"',
        '-q:v', '3',
        `"${jpegPath}"`,
      ].join(' ');

      execSync(fallbackCmd, { stdio: 'ignore', timeout: 30000 });

      // If JPEG was created, rename to the expected output path
      if (fs.existsSync(jpegPath)) {
        fs.renameSync(jpegPath, outputPath);
      }
    }
  }

  /**
   * Clean up temp directory and its contents.
   */
  private cleanupTmp(dir: string): void {
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          fs.unlinkSync(path.join(dir, file));
        }
        fs.rmdirSync(dir);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
