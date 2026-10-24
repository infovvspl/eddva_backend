import { ACTIVITY_SECTIONS, ActivitySection } from './activity/activity-credit';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class HeartbeatDto {
  @IsIn(ACTIVITY_SECTIONS as unknown as string[])
  section: ActivitySection;

  @IsOptional()
  @IsUUID()
  threadId?: string;

  @IsOptional()
  @IsUUID()
  stepId?: string;

  /** Active seconds counted by the client since its previous heartbeat; several when replaying an offline queue. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(60, { each: true })
  beats: number[];

  @IsOptional()
  @IsIn(['web', 'mobile', 'tablet'])
  device?: string;
}

/** Exactly one of topicId (a roadmap topic) or general is checked by the service. */
export class OpenThreadDto {
  @IsOptional()
  @IsUUID()
  topicId?: string;

  @IsOptional()
  @IsBoolean()
  general?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  focusSubtopic?: string;
}

export class ThreadPageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}

export class PostThreadMessageDto {
  @IsString()
  @Length(1, 2000)
  text: string;

  /** 'quiz': ask for practice questions answered by tapping an option. */
  @IsOptional()
  @IsIn(['chat', 'quiz'])
  mode?: 'chat' | 'quiz';
}

export class SaveChatQuizResultDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(5, { each: true })
  answers: number[];
}

export class OpenStepDto {
  /** Start a fresh quiz after a submitted one (quizzes only; an assessment is one attempt). */
  @IsOptional()
  @IsBoolean()
  retake?: boolean;
}

export class StepProgressDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[A-Za-z0-9_-]{11}$/, { each: true })
  watchedVideoIds?: string[];

  @IsOptional()
  @IsBoolean()
  videosDone?: boolean;

  @IsOptional()
  @IsBoolean()
  notesDone?: boolean;
}

export class RecomputeMasteryDto {
  /** One student (students.id); omit to queue every student of the caller's institute. */
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class QuizAnswersDto {
  /** questionId -> optionId. Unknown ids are ignored by the server. */
  @IsObject()
  answers: Record<string, string>;
}

export class SaveNotesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  highlights?: unknown[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  inlineComments?: unknown[];

  /** Where the student was in the notes, e.g. { headingId, offsetPct }; null clears it. */
  @IsOptional()
  @IsObject()
  lastAnchor?: Record<string, unknown> | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60)
  timeSpentSeconds?: number;
}
