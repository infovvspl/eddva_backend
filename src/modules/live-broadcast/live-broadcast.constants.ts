export const RECORDINGS_QUEUE = 'live-recordings';
export const RECORDING_JOB = 'process-recording';

export interface RecordingJobData {
  lectureId: string;
  streamKey: string;
  instId: string;
}
