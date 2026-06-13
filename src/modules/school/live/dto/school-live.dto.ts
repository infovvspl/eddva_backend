import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLiveLectureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;
}

/** nginx-rtmp sends `name` = stream key on on_publish / on_publish_done. */
export class RtmpHookDto {
  @IsString()
  name: string;
}
