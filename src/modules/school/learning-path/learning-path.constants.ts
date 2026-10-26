export const LEARNING_PATH_QUEUE = 'learning-path';
export const RECOMPUTE_STUDENT_JOB = 'recompute-student';

export interface RecomputeStudentJobData {
  studentId: string;
}

export const ROADMAP_CHAPTER_JOB = 'roadmap-chapter';

export interface RoadmapChapterJobData {
  /** 'chapter': roadmap of a weak chapter; 'topic': subtopics of one weak recorded topic (topicId). */
  kind: 'chapter' | 'topic';
  chapterId: string;
  topicId: string | null;
  instituteId: string | null;
  className: string | null;
}

/** Evidence older than this is not ingested; at a 30-day half-life it would weigh under 0.03%. */
export const EVIDENCE_LOOKBACK_DAYS = 365;

/** Bursts (a teacher entering a whole class's marks) collapse into one job per student. */
export const RECOMPUTE_DEBOUNCE_MS = 30_000;

/** Distinct keys for pg_try_advisory_xact_lock so only one instance runs each scan. */
export const CHANGE_SCAN_LOCK_KEY = 79_115_001;
export const NIGHTLY_SCAN_LOCK_KEY = 79_115_002;
