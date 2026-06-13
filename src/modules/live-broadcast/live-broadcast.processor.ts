import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { execFile } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';

import { R2Service } from '../storage/r2.service';
import {
  RECORDING_JOB,
  RECORDINGS_QUEUE,
  type RecordingJobData,
} from './live-broadcast.constants';
import { LIVE_CHANNELS, LiveBroadcastRedis } from './live-broadcast.redis';
import { LiveBroadcastService } from './live-broadcast.service';

const execFileAsync = promisify(execFile);

@Processor(RECORDINGS_QUEUE)
export class RecordingProcessor {
  private readonly logger = new Logger(RecordingProcessor.name);

  constructor(
    private readonly r2: R2Service,
    private readonly svc: LiveBroadcastService,
    private readonly redis: LiveBroadcastRedis,
  ) {}

  @Process(RECORDING_JOB)
  async process(job: Job<RecordingJobData>) {
    const { lectureId, streamKey, instId } = job.data;
    const inputPath = `/tmp/recordings/${streamKey}.mp4`;
    const thumbPath = `/tmp/${lectureId}-thumb.jpg`;

    this.logger.log(`Processing recording for lecture ${lectureId} (${inputPath})`);

    try {
      // 1. Wait for the file (ffmpeg/nginx may still be flushing it).
      await this.waitForFile(inputPath, 300);

      // 2. Thumbnail at the 30s mark.
      await execFileAsync('ffmpeg', [
        '-ss', '30', '-i', inputPath, '-vframes', '1', '-q:v', '2',
        '-vf', 'scale=1280:720', '-y', thumbPath,
      ]);

      // 3. Probe metadata.
      const meta = await this.getVideoMetadata(inputPath);

      // 4. Upload recording + thumbnail to R2.
      const recKey = `recordings/${instId}/${lectureId}/lecture.mp4`;
      const thumbKey = `recordings/${instId}/${lectureId}/thumbnail.jpg`;
      const recSize = fs.statSync(inputPath).size;

      await this.r2.putObject(
        this.r2.recordingsBucket, recKey,
        fs.createReadStream(inputPath), 'video/mp4', 'public, max-age=31536000', recSize,
      );
      await this.r2.putObject(
        this.r2.recordingsBucket, thumbKey,
        fs.createReadStream(thumbPath), 'image/jpeg', 'public, max-age=31536000',
        fs.statSync(thumbPath).size,
      );

      // 5. Mark processed.
      await this.svc.markProcessed(lectureId, {
        recordingR2Path: recKey,
        thumbnailR2Path: thumbKey,
        durationSeconds: Math.floor(meta.duration),
        recordingSizeGb: recSize / 1e9,
      });

      // 6. Notify (Socket.io picks this up).
      await this.redis.publish(LIVE_CHANNELS.PROCESSED, { lectureId });

      // 7. Cleanup.
      this.safeUnlink(inputPath);
      this.safeUnlink(thumbPath);

      this.logger.log(`Recording processed for lecture ${lectureId} (${(recSize / 1e9).toFixed(2)} GB)`);
    } catch (err) {
      this.logger.error(`Recording job failed for lecture ${lectureId}: ${(err as Error).message}`);
      // On the final attempt, flag the lecture so the UI can surface it.
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.svc.markProcessingFailed(lectureId).catch(() => undefined);
      }
      throw err; // let Bull handle retry/backoff
    }
  }

  private async waitForFile(path: string, timeoutSeconds: number): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      if (fs.existsSync(path) && fs.statSync(path).size > 0) return;
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error(`Recording file not found within ${timeoutSeconds}s: ${path}`);
  }

  private async getVideoMetadata(path: string): Promise<{ duration: number; width: number; height: number }> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'format=duration:stream=width,height',
      '-of', 'json', path,
    ]);
    const json = JSON.parse(stdout);
    const stream = json.streams?.[0] || {};
    return {
      duration: parseFloat(json.format?.duration ?? '0') || 0,
      width: Number(stream.width) || 0,
      height: Number(stream.height) || 0,
    };
  }

  private safeUnlink(path: string) {
    try {
      if (fs.existsSync(path)) fs.unlinkSync(path);
    } catch (e) {
      this.logger.warn(`Cleanup failed for ${path}: ${(e as Error).message}`);
    }
  }
}
