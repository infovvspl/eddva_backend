import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class AnswerQuestionDto {
  @IsUUID()
  questionId: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  selectedOptionIds?: string[];

  @IsOptional()
  @IsString()
  integerResponse?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timeTakenSeconds?: number;
}
