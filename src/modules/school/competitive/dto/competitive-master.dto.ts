import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMasterSubjectDto {
  @IsString() examId: string;
  @IsString() @MinLength(1) name: string;
}

export class UpdateMasterSubjectDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateMasterExamDto {
  @IsString() @MinLength(1) code: string;
  @IsString() @MinLength(1) name: string;
}

export class UpdateMasterExamDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateMasterChapterDto {
  @IsString() masterSubjectId: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsInt() @Type(() => Number) sortOrder?: number;
}

export class CreateMasterTopicDto {
  @IsString() masterChapterId: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsInt() @Type(() => Number) sortOrder?: number;
}

export class CreateCompetitiveQuestionDto {
  @IsOptional() @IsString() masterTopicId?: string;
  @IsString() examTarget: string;
  @IsOptional() @IsInt() @Type(() => Number) examYear?: number;
  @IsOptional() @IsString() difficulty?: string;
  @IsOptional() @IsString() questionType?: string;
  @IsString() @MinLength(1) questionText: string;
  @IsOptional() options?: Record<string, string>;
  @IsOptional() @IsString() correctAnswer?: string;
  @IsOptional() @IsString() explanation?: string;
  @IsOptional() @IsIn(['pyq', 'ai_generated', 'manual']) source?: string;
  @IsOptional() @IsArray() tags?: string[];
}

export class VerifyQuestionDto {
  @IsOptional() @IsString() masterTopicId?: string;
  @IsOptional() @IsString() correctAnswer?: string;
  @IsOptional() @IsString() explanation?: string;
}

export class IngestFromPdfDto {
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsString() answerKeyFileUrl?: string;
  // The exam target is derived server-side from this subject's own exam
  // (every subject belongs to exactly one exam now) rather than taken as a
  // separate client-supplied field, so it can't mismatch what was actually
  // picked (e.g. the NEET Biology subject with a "jee_mains" exam target).
  @IsString() masterSubjectId: string;
  @IsOptional() @IsInt() @Type(() => Number) examYear?: number;
  @IsIn(['pyq', 'question_bank']) source: 'pyq' | 'question_bank';
}

export class ListQuestionsQueryDto {
  @IsOptional() @IsString() masterTopicId?: string;
  @IsOptional() @IsString() examTarget?: string;
  @IsOptional() @IsIn(['true', 'false']) isVerified?: string;
  @IsOptional() @Type(() => Number) @IsInt() page?: number;
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}
