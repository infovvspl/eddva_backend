import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { promisify } from 'util';

import { R2Service } from '../storage/r2.service';
import {
  RECORDING_JOB,
  RECORDINGS_QUEUE,
  type RecordingJobData,
} from './live-broadcast.constants';
import { LIVE_CHANNELS, LiveBroadcastRedis } from './live-broadcast.redis';
import { LiveBroadcastService } from './live-broadcast.service';
import { SchoolLiveService } from '../school/live/school-live.service';

const execFileAsync = promisify(execFile);

@Processor(RECORDINGS_QUEUE)
export class RecordingProcessor {
  private readonly logger = new Logger(RecordingProcessor.name);

  constructor(
    private readonly r2: R2Service,
    private readonly svc: LiveBroadcastService,
    private readonly schoolSvc: SchoolLiveService,
    private readonly redis: LiveBroadcastRedis,
    private readonly config: ConfigService,
  ) {}

  @Process(RECORDING_JOB)
  async process(job: Job<RecordingJobData>) {
    const { lectureId, streamKey, instId, vertical = 'coaching' } = job.data;

    this.logger.log(`Processing recording — vertical=${vertical} lecture=${lectureId}`);

    // The streaming server serves finished MP4s at this URL.
    // nginx-rtmp records FLV → exec_record_done converts to MP4 → nginx serves it.
    const streamingServerPrivateIp = this.config.get<string>('streaming.serverPrivateIp')
      || this.config.get<string>('streaming.serverIp');
    const recordingBaseUrl = `http://${streamingServerPrivateIp}:8080/recordings`;
    const remoteUrl = `${recordingBaseUrl}/${streamKey}.mp4`;

    // Wait for the MP4 to be ready on the streaming server (ffmpeg conversion runs
    // asynchronously after OBS disconnects — can take 30-90s for a 1-hour stream).
    await this.waitForRemoteFile(remoteUrl, 600);

    // Stream the MP4 from the streaming server → temp file on this server.
    // Temp file avoids buffering GB of data in RAM.
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `rec_${streamKey}.mp4`);
    const thumbPath = path.join(tmpDir, `thumb_${lectureId}.jpg`);

    try {
      await this.downloadToFile(remoteUrl, tmpPath);

      // Thumbnail at the 30s mark.
      await execFileAsync('ffmpeg', [
        '-ss', '30', '-i', tmpPath, '-vframes', '1', '-q:v', '2',
        '-vf', 'scale=1280:720', '-y', thumbPath,
      ]);

      // Probe duration.
      const meta = await this.getVideoMetadata(tmpPath);

      // R2 paths — school and coaching use isolated prefixes.
      const prefix = vertical === 'school' ? 'school-recordings' : 'recordings';
      const recKey  = `${prefix}/${instId}/${lectureId}/lecture.mp4`;
      const thumbKey = `${prefix}/${instId}/${lectureId}/thumbnail.jpg`;
      const recSize  = fs.statSync(tmpPath).size;

      await this.r2.putObject(
        this.r2.recordingsBucket, recKey,
        fs.createReadStream(tmpPath), 'video/mp4', 'public, max-age=31536000', recSize,
      );
      await this.r2.putObject(
        this.r2.recordingsBucket, thumbKey,
        fs.createReadStream(thumbPath), 'image/jpeg', 'public, max-age=31536000',
        fs.statSync(thumbPath).size,
      );

      // Mark processed in the appropriate vertical's DB.
      if (vertical === 'school') {
        await this.schoolSvc.markProcessed(lectureId, {
          recordingUrl: recKey,
          thumbnailUrl: thumbKey,
          durationSeconds: Math.floor(meta.duration),
          recordingSizeGb: recSize / 1e9,
        });
        await this.schoolSvc.notifyProcessed(lectureId);
      } else {
        await this.svc.markProcessed(lectureId, {
          recordingR2Path: recKey,
          thumbnailR2Path: thumbKey,
          durationSeconds: Math.floor(meta.duration),
          recordingSizeGb: recSize / 1e9,
        });
        // Coaching uses the socket event; school gateway subscribes to its own channel.
        await this.redis.publish(LIVE_CHANNELS.PROCESSED, { lectureId });
      }

      this.logger.log(
        `Recording processed — vertical=${vertical} lecture=${lectureId} ` +
        `size=${(recSize / 1e9).toFixed(2)}GB duration=${Math.floor(meta.duration)}s`,
      );
    } finally {
      this.safeUnlink(tmpPath);
      this.safeUnlink(thumbPath);
    }
  }

  /**
   * Poll the streaming server's HTTP endpoint until the MP4 is accessible.
   * nginx-rtmp runs exec_record_done (FLV→MP4 via ffmpeg) asynchronously after
   * OBS disconnects — this can take 30-90 s for a 1-hour stream with copy codec.
   */
  private async waitForRemoteFile(url: string, timeoutSeconds: number): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        if (res.ok && parseInt(res.headers.get('content-length') || '0', 10) > 0) return;
      } catch { /* network error or not ready — retry */ }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    throw new Error(`Recording not available after ${timeoutSeconds}s: ${url}`);
  }

  /** Stream the remote MP4 to a local temp file (avoids buffering GB in RAM). */
  private async downloadToFile(url: string, dest: string): Promise<void> {
    const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`Failed to fetch recording: HTTP ${res.status}`);
    await pipeline(
      // node-fetch / undici body is a Web ReadableStream — convert to Node stream.
      Readable.fromWeb(res.body as any),
      fs.createWriteStream(dest),
    );
  }

  private async getVideoMetadata(filePath: string): Promise<{ duration: number }> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json', filePath,
    ]);
    const json = JSON.parse(stdout);
    return { duration: parseFloat(json.format?.duration ?? '0') || 0 };
  }

  private safeUnlink(filePath: string) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* non-fatal */ }
  }
}
