import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCompetitiveSubjectDto {
  @IsString() masterSubjectId: string;
  @IsString() classId: string;
  @IsOptional() @IsString() @MinLength(1) displayName?: string;
}

export class UpdateCompetitiveSubjectDto {
  @IsOptional() @IsString() @MinLength(1) displayName?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AssignTeacherDto {
  @IsString() teacherId: string;
  @IsOptional() @IsString() sectionId?: string;
}

export class CreateGroundingLinkDto {
  @IsString() masterTopicId: string;
  @IsString() schoolTopicId: string;
}
