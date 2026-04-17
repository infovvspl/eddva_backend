import { IsEnum, IsString, IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';

export enum UploadType {
  PROFILE = 'profile',
  THUMBNAIL = 'thumbnail',
  MATERIAL = 'material',
  SOURCE = 'source',
  LECTURE_VIDEO = 'lecture-video',
  LECTURE_THUMBNAIL = 'lecture-thumbnail',
  LECTURE_ATTACHMENT = 'lecture-attachment',
}

export class GenerateUploadUrlDto {
  @IsEnum(UploadType, { message: 'Invalid upload type' })
  @IsNotEmpty()
  type: UploadType;

  @IsString()
  @IsOptional()
  courseId?: string;

  @IsString()
  @IsOptional()
  lectureId?: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsNumber()
  @Min(1)
  fileSize: number;
}
