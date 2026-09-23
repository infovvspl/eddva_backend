import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateTutorConversationDto {
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;
}

export class SendTutorMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}
