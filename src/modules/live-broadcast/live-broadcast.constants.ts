export const RECORDINGS_QUEUE = 'live-recordings';
export const RECORDING_JOB = 'process-recording';

export interface RecordingJobData {
  lectureId: string;
  streamKey: string;
  instId: string;
  /** 'coaching' (default) or 'school' — controls which DB table is updated. */
  vertical?: 'coaching' | 'school';
}
