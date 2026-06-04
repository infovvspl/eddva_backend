import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class GeneratePptDto {
  @IsString()
  @IsNotEmpty()
  topic: string;

  @IsString()
  @IsOptional()
  classLevel?: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  board?: string;
}
