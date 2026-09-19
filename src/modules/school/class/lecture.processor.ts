import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { SchoolClassService } from './school-class.service';
import {
  LECTURE_JOB,
  LECTURE_QUEUE,
  LECTURE_WORKER_CONCURRENCY,
  type LectureJobData,
} from './lecture-queue.constants';

/**
 * Durable worker for lecture transcription + notes (P0-2). Delegates the actual
 * stage work to SchoolClassService.runLectureJob so all DB/AI logic stays in one
 * place; this class only owns the queue wiring, bounded concurrency, and marking
 * a job FAILED once Bull has exhausted its bounded retries.
 *
 * Stage-level retry is achieved by runLectureJob() skipping stages already marked
 * done in class_recordings — so a notes failure re-runs notes only, never
 * re-transcribes. Provider-level retry/rotation stays inside the Django AI service.
 */
@Processor(LECTURE_QUEUE)
export class LectureProcessor {
  private readonly logger = new Logger(LectureProcessor.name);

  constructor(private readonly svc: SchoolClassService) {}

  @Process({ name: LECTURE_JOB, concurrency: LECTURE_WORKER_CONCURRENCY })
  async process(job: Job<LectureJobData>): Promise<void> {
    this.logger.log(
      `Lecture job start recording=${job.data.recordingId} attempt=${job.attemptsMade + 1} institute=${job.data.instituteId}`,
    );
    // Throws on a retryable failure (Bull retries with backoff); resolves on
    // success OR on a permanent failure that runLectureJob has already recorded
    // as FAILED (so Bull does not waste further attempts on it).
    await this.svc.runLectureJob(job.data, job.attemptsMade + 1);
  }

  @OnQueueFailed()
  async onFailed(job: Job<LectureJobData>, err: Error) {
    const attempts = job.opts?.attempts ?? 1;
    const exhausted = job.attemptsMade >= attempts;
    this.logger.warn(
      `Lecture job failed recording=${job.data?.recordingId} attempt=${job.attemptsMade}/${attempts} exhausted=${exhausted}: ${err?.message}`,
    );
    if (exhausted) {
      // Bull will not retry again — persist the terminal FAILED state.
      await this.svc.markLectureJobFailed(job.data.recordingId, 'retries_exhausted', err?.message);
    }
  }
}
