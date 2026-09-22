import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
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

export class CreateLessonPlanDto {
  @IsOptional()
  @IsString()
  academicYear?: string;

  @IsString()
  classId: string;

  @IsString()
  sectionId: string;

  @IsString()
  subjectId: string;

  @IsOptional()
  @IsString()
  chapterId?: string;

  @IsOptional()
  @IsString()
  topicId?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsNumber()
  durationPeriods?: number;

  @IsOptional()
  @IsString()
  learningObjectives?: string;

  @IsOptional()
  @IsString()
  previousKnowledge?: string;

  @IsOptional()
  @IsString()
  teachingMethodology?: string;

  @IsOptional()
  @IsString()
  teachingActivities?: string;

  @IsOptional()
  @IsString()
  teachingResources?: string;

  @IsOptional()
  @IsString()
  digitalResources?: string;

  @IsOptional()
  @IsString()
  classroomActivities?: string;

  @IsOptional()
  @IsString()
  assessmentMethod?: string;

  @IsOptional()
  @IsString()
  homework?: string;

  @IsOptional()
  @IsString()
  expectedLearningOutcomes?: string;

  @IsOptional()
  @IsString()
  teacherNotes?: string;

  @IsOptional()
  @IsString()
  timetableId?: string | null;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  aiBrief?: string;
}

export class GenerateAiLessonTemplateDto {
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  chapterId?: string;

  // Unused by generateAiLessonTemplate today but sent by the modal — kept to avoid rejection.
  @IsOptional()
  @IsString()
  topicId?: string;

  @IsOptional()
  @IsString()
  subjectName?: string;

  @IsOptional()
  @IsString()
  chapterName?: string;

  @IsOptional()
  @IsString()
  className?: string;

  @IsOptional()
  @IsString()
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

  // Only used by the "lesson launched directly from a timetable slot" dynamic-create
  // fallback — not sent by the current lesson-completion modal, but a real code path.
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
