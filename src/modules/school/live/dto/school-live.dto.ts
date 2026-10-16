import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateLiveLectureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  className?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sectionName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subjectName?: string;
}

/** B-08: change a class that has not started. Every field is optional. */
export class UpdateLiveLectureDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

/** nginx-rtmp sends `name` = stream key on on_publish / on_publish_done. */
export class RtmpHookDto {
  @IsString()
  name: string;
}
