/**
 * Chapter lesson plans: a teacher creates one per chapter (AI from the school's
 * textbook, an uploaded file read by AI, or by hand), submits it, and the
 * institute admin approves it or sends it back. See LessonPlanService.
 */
export const LESSON_PLAN_QUEUE = 'school-lesson-plan-generation';
export const LESSON_PLAN_GENERATE_JOB = 'generate';

export interface LessonPlanJobData {
  planId: string;
  instituteId: string;
  teacherUserId: string;
  /** Times this plan was put back in the queue because the AI pool was busy. */
  deferrals?: number;
}

/**
 * The backend's background AI pool admits one call per school at a time and
 * makes the next wait at most 60 s (AI_ADMISSION_BACKGROUND_*). A plan takes
 * 40-120 s, so a plan that finds the pool busy goes back in the queue instead of
 * failing: up to this many times, this far apart (about 10 minutes in all, the
 * same as the stale-generation limit).
 */
export const MAX_ADMISSION_DEFERRALS = 10;
export const ADMISSION_DEFER_MS = 45_000;

export const LESSON_PLAN_STATUS = {
  GENERATING: 'GENERATING',
  DRAFT: 'DRAFT',
  FAILED: 'FAILED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  APPROVED: 'APPROVED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type LessonPlanStatus = typeof LESSON_PLAN_STATUS[keyof typeof LESSON_PLAN_STATUS];

/** A teacher has at most one of these per chapter, beside at most one APPROVED. */
export const WORKING_STATUSES: LessonPlanStatus[] = ['GENERATING', 'DRAFT', 'FAILED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED'];
/** States in which the teacher may edit the content. */
export const EDITABLE_STATUSES: LessonPlanStatus[] = ['DRAFT', 'CHANGES_REQUESTED'];

export const LESSON_PLAN_SOURCES = ['AI', 'UPLOAD', 'MANUAL'] as const;
export type LessonPlanSource = typeof LESSON_PLAN_SOURCES[number];

/** Teaching record per period and section, on an approved plan. NOT_STARTED clears the record. */
export const PROGRESS_STATUSES = ['TAUGHT', 'PARTIAL', 'SKIPPED'] as const;
export type ProgressStatus = typeof PROGRESS_STATUSES[number];
/** A period counts as done for the chapter (and the Syllabus Planner) when taught or deliberately skipped. */
export const DONE_PROGRESS: ProgressStatus[] = ['TAUGHT', 'SKIPPED'];

/** Uploaded plans: PDF only (Word needs a parser the backend does not ship yet). */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** The AI service reads at most this much of an uploaded document (bridge.py, lesson_plan_extract). */
export const UPLOAD_MAX_TEXT_CHARS = 24_000;
/** Less readable text than this is almost certainly a scanned (image-only) PDF. */
export const UPLOAD_MIN_TEXT_CHARS = 200;

export const DEFAULT_PERIODS = 6;
export const MIN_PERIODS = 1;
export const MAX_PERIODS = 20;
/** Chapters per "generate the whole subject" request. */
export const MAX_CHAPTERS_PER_REQUEST = 40;

/** Header fields: API name -> column. Shared by the parser, service and DTOs. */
export const PLAN_FIELDS = {
  learningObjectives: 'learning_objectives',
  priorKnowledge: 'prior_knowledge',
  methodology: 'methodology',
  resources: 'resources',
  digitalResources: 'digital_resources',
  assessmentPlan: 'assessment_plan',
  homeworkSummary: 'homework_summary',
  expectedOutcomes: 'expected_outcomes',
} as const;
export type PlanFieldKey = keyof typeof PLAN_FIELDS;

export const PERIOD_FIELDS = ['objectives', 'activities', 'resources', 'assessment', 'homework'] as const;
export type PeriodFieldKey = typeof PERIOD_FIELDS[number];
