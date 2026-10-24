import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  LESSON_PLAN_STATUS, MAX_CHAPTERS_PER_REQUEST, MAX_PERIODS, MIN_PERIODS, PROGRESS_STATUSES, ProgressStatus,
} from '../lesson-plan.constants';

const TEXT_MAX = 20_000;

/** Teacher: AI-generate plans for one or more chapters (or the whole subject). */
export class GenerateLessonPlansDto {
  @IsUUID() classId: string;
  @IsUUID() subjectId: string;

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_CHAPTERS_PER_REQUEST) @IsUUID('all', { each: true })
  chapterIds?: string[];

  /** Every chapter of the subject (chapterIds is then ignored). */
  @IsOptional() @IsBoolean() allChapters?: boolean;

  /** Periods per chapter; otherwise the Syllabus Planner's planned periods, else 6. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(MIN_PERIODS) @Max(MAX_PERIODS) periods?: number;

  /** Replace a draft, failed or sent-back plan for the chapter. */
  @IsOptional() @IsBoolean() regenerate?: boolean;

  /** Minutes per period; otherwise the school's period length (school_periods), else 40. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(20) @Max(120) minutesPerPeriod?: number;
}

/** Teacher: start a blank plan to fill in by hand. */
export class CreateManualLessonPlanDto {
  @IsUUID() classId: string;
  @IsUUID() subjectId: string;
  @IsUUID() chapterId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(MIN_PERIODS) @Max(MAX_PERIODS) periods?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(20) @Max(120) minutesPerPeriod?: number;
}

export class LessonPlanPeriodDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) objectives?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) activities?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) resources?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) assessment?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) homework?: string;
}

/**
 * Teacher: save the editor (a draft or a sent-back plan). `revision` is the one
 * the editor loaded; a save from an older copy is refused (409). A structured
 * (v2) plan sends the whole `content`; a v1 plan sends text fields and periods.
 */
export class UpdateLessonPlanDto {
  @Type(() => Number) @IsInt() @Min(0) revision: number;

  /** The whole v2 plan; validated by LessonPlanService (lesson-plan-schema.ts). */
  @IsOptional() @IsObject() content?: Record<string, any>;

  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) learningObjectives?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) priorKnowledge?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) methodology?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) resources?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) digitalResources?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) assessmentPlan?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) homeworkSummary?: string;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX) expectedOutcomes?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_PERIODS) @ValidateNested({ each: true }) @Type(() => LessonPlanPeriodDto)
  periods?: LessonPlanPeriodDto[];
}

/** Teacher: submit for approval, from the revision on screen. */
export class SubmitLessonPlanDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) revision?: number;
}

export const REGENERATABLE_PARTS = [
  'period', 'objectives', 'outcomes', 'prerequisites', 'keyConcepts', 'resources', 'misconceptions', 'differentiation',
] as const;

/** Teacher: rewrite one part of a draft with AI, leaving the rest untouched. */
export class RegenerateSectionDto {
  @Type(() => Number) @IsInt() @Min(0) revision: number;
  @IsIn(REGENERATABLE_PARTS as unknown as string[]) part: typeof REGENERATABLE_PARTS[number];
  /** Required when part = period. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PERIODS) periodNumber?: number;
  /** What the teacher wants changed, e.g. "add a group activity". */
  @IsOptional() @IsString() @MaxLength(500) instruction?: string;
}

/**
 * Teacher: record how one period went in one section of an approved plan.
 * NOT_STARTED removes the record. `sectionId` is one of the plan's sections
 * (the class id when the teacher's class has no sections).
 */
export class RecordProgressDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PERIODS) periodNo: number;
  @IsUUID() sectionId: string;
  @IsIn([...PROGRESS_STATUSES, 'NOT_STARTED']) status: ProgressStatus | 'NOT_STARTED';
  /** Defaults to today for TAUGHT / PARTIAL; never in the future. */
  @IsOptional() @IsDateString() taughtOn?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** Teacher: private notes on their own plan (never shown to the admin). */
export class SaveLessonPlanNotesDto {
  @IsString() @MaxLength(TEXT_MAX) note: string;
}

/** Teacher: import an uploaded PDF plan (multipart fields; the file is `file`). */
export class ImportLessonPlanDto {
  @IsUUID() classId: string;
  @IsUUID() subjectId: string;
  @IsUUID() chapterId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(20) @Max(120) minutesPerPeriod?: number;
}

/** Admin: send a plan back to the teacher. */
export class SendBackLessonPlanDto {
  @IsString() @MaxLength(2000) comment: string;
}

/** Admin: list filters. */
export class ListLessonPlansQueryDto {
  @IsOptional() @IsIn(Object.values(LESSON_PLAN_STATUS)) status?: string;
  @IsOptional() @IsUUID() teacherUserId?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsUUID() subjectId?: string;
}
