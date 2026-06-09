import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, ValidateNested } from 'class-validator';

export class QuizAnswerDto {
  @IsString()
  questionId: string;

  @IsString()
  value: string;
}

export class SubmitQuizDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers: QuizAnswerDto[];
}
