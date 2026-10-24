import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Global ValidationPipe runs with whitelist + forbidNonWhitelisted — every field the
// frontend ever sends for these endpoints must be declared here, even fields the
// service itself doesn't read, or the request gets rejected with a 400. Field lists
// were cross-checked against both the service's `body.x` reads and the actual
// object literals built in SyllabusPlanner.jsx / SyllabusPlanDetailsPage.jsx /
// LessonPlanFormModal.jsx / LessonCompletionModal.jsx.

export class ChapterAllocationTopicDto {
  @IsOptional()
  @IsString()
  topicId?: string;

  @IsOptional()
  @IsString()
  topicName?: string;

  @IsOptional()
  @IsBoolean()
  addedByTeacher?: boolean;
}

export class ChapterAllocationDto {
  @IsOptional()
  @IsString()
  chapterId?: string;

  @IsOptional()
  @IsString()
  chapterName?: string;

  @IsOptional()
  @IsString()
  term?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChapterAllocationTopicDto)
  topics?: ChapterAllocationTopicDto[];

  @IsOptional()
  @IsNumber()
  periods?: number;

  @IsOptional()
  @IsNumber()
  plannedPeriods?: number;
}

export class CreateSyllabusPlanDto {
  @IsOptional()
  @IsString()
  academicYear?: string;

  @IsOptional()
  @IsString()
  classId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  classIds?: string[];

  @IsOptional()
  @IsString()
  sectionId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sectionIds?: (string | null)[];

  @IsString()
  subjectId: string;

  // Sent by the plan-creation form's leftover state but unused by createSyllabusPlan —
  // must stay declared here or forbidNonWhitelisted rejects the request.
  @IsOptional()
  @IsString()
  chapterId?: string;

  @IsOptional()
  @IsString()
  topicId?: string;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @IsString()
  plannedStartDate?: string;

  @IsOptional()
  @IsString()
  plannedCompletionDate?: string;

  @IsOptional()
  @IsNumber()
  plannedPeriods?: number;

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsString()
  term?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChapterAllocationDto)
  chapterAllocations?: ChapterAllocationDto[];
}

export class UpdateSyllabusPlanDto {
  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @IsString()
  term?: string;

  @IsOptional()
  @IsNumber()
  plannedPeriods?: number;

  @IsOptional()
  @IsString()
  plannedStartDate?: string;

  @IsOptional()
  @IsString()
  plannedCompletionDate?: string;

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChapterAllocationDto)
  chapterAllocations?: ChapterAllocationDto[];
}

export class UpdateSyllabusPlanProgressDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChapterAllocationDto)
  chapterAllocations?: ChapterAllocationDto[];

  @IsOptional()
  @IsString()
  topicId?: string;

  @IsOptional()
  @IsString()
  topicName?: string;

  @IsOptional()
  @IsString()
  chapterId?: string;

  @IsOptional()
  @IsString()
  chapterName?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  progress?: number;

  @IsOptional()
  @IsNumber()
  actualPeriods?: number;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsString()
  delayReason?: string | null;

  @IsOptional()
  @IsString()
  carryForwardDate?: string | null;

  // Sent by SyllabusPlanDetailsPage.jsx but not read by the service today — kept so the
  // request isn't rejected; harmless to accept and ignore.
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  completionDate?: string | null;
}

/** The lesson form sends '' for a field nobody picked; treat that as not given. */
const emptyToUndefined = () => Transform(({ value }) => (value === '' ? undefined : value));

const LESSON_TEXT_MAX = 20000;

export class CreateLessonPlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  academicYear?: string;

  @IsUUID()
  classId: string;

  @IsUUID()
  sectionId: string;

  @IsUUID()
  subjectId: string;

  @IsOptional()
  @emptyToUndefined()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @emptyToUndefined()
  @IsUUID()
  topicId?: string;

  @IsOptional()
  @emptyToUndefined()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  durationPeriods?: number;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  learningObjectives?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  previousKnowledge?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  teachingMethodology?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  teachingActivities?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  teachingResources?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  digitalResources?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  classroomActivities?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  assessmentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  homework?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  expectedLearningOutcomes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  teacherNotes?: string;

  @IsOptional()
  @emptyToUndefined()
  @IsUUID()
  timetableId?: string | null;

  /** A new plan is scheduled or a draft; completion goes through /complete. */
  @IsOptional()
  @IsIn(['SCHEDULED', 'DRAFT'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LESSON_TEXT_MAX)
  aiBrief?: string;
}

export class GenerateAiLessonTemplateDto {
  @IsOptional()
  @emptyToUndefined()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @emptyToUndefined()
  @IsUUID()
  chapterId?: string;

  // Unused by generateAiLessonTemplate today but sent by the modal — kept to avoid rejection.
  @IsOptional()
  @emptyToUndefined()
  @IsUUID()
  topicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  subjectName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  chapterName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  className?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  topicName?: string;
}

export class CompleteLessonPlanDto {
  @IsOptional()
  @IsIn(['FULLY', 'PARTIALLY', 'NOT_COMPLETED'])
  completionType?: string;

  @IsOptional()
  @IsString()
  actualDate?: string;

  @IsOptional()
  @IsNumber()
  actualDurationPeriods?: number;

  @IsOptional()
  @IsString()
  topicsCovered?: string;

  @IsOptional()
  @IsString()
  learningObjectivesAchieved?: string;

  // Frontend sends a string rating label (e.g. "Excellent"); the service also accepts a
  // raw number, so both shapes are allowed here rather than forcing one.
  @IsOptional()
  studentUnderstandingRating?: string | number;

  @IsOptional()
  @IsString()
  homeworkAssigned?: string;

  @IsOptional()
  @IsString()
  assessmentConducted?: string;

  @IsOptional()
  @IsString()
  teacherReflection?: string;

  @IsOptional()
  @IsString()
  additionalRemarks?: string;

  @IsOptional()
  @IsString()
  delayReason?: string;

  @IsOptional()
  @IsString()
  carryForwardDate?: string | null;

  // Accepted for older clients but no longer used: completing an unknown lesson id
  // used to create a plan from these; it now returns 404.
  @IsOptional()
  @IsString()
  classId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;
}

export class CreateLessonTemplateDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsObject()
  contentJson?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;
}
