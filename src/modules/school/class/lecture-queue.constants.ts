/**
 * Durable lecture-processing queue (P0-2).
 *
 * A dedicated Bull queue, separate from RECORDINGS_QUEUE (live-broadcast) and from
 * the synchronous real-time AI path (doubts/quiz), so a burst of lecture jobs can
 * never starve latency-sensitive AI traffic.
 */
export const LECTURE_QUEUE = 'school-lecture-processing';
export const LECTURE_JOB = 'process-lecture';

/**
 * Bounded worker concurrency. Each lecture fans out to ~25–35 provider calls
 * INSIDE the Django AI service (transcript cleanup + chunk notes + merge + polish),
 * so 2 concurrent lectures already put ~50–70 calls in flight against the shared
 * 20-key Groq pool. Higher would crowd out real-time doubts; lower wastes capacity.
 * Env-overridable for staging tuning without a code change.
 */
export const LECTURE_WORKER_CONCURRENCY = Number(process.env.LECTURE_WORKER_CONCURRENCY || 2);

/** Persisted job lifecycle. Kept minimal — only states the pipeline actually has. */
export enum LectureJobStatus {
  QUEUED = 'QUEUED',
  TRANSCRIBING = 'TRANSCRIBING',
  GENERATING_NOTES = 'GENERATING_NOTES',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/** Coarse, stage-based progress (no invented percentages). */
export const LECTURE_STAGE_PROGRESS: Record<string, number> = {
  QUEUED: 0,
  TRANSCRIBING: 25,
  GENERATING_NOTES: 65,
  COMPLETED: 100,
  FAILED: 100,
};

/**
 * Everything the worker needs to run WITHOUT relying on AsyncLocalStorage (which
 * does not survive into a background worker). The authenticated identity is
 * captured at enqueue time from the guard-verified request and persisted here +
 * in lecture_jobs, then re-established by the worker for downstream AI attribution.
 */
export interface LectureJobData {
  recordingId: string;
  instituteId: string;
  userId: string | null;
  userRole: string | null;
  requestId: string;
  /** true = re-run stages even if already marked done (retranscribe/regenerate). */
  force?: boolean;
  /** limit a forced re-run to a single stage: 'notes' re-runs notes only. */
  only?: 'transcript' | 'notes';
}
