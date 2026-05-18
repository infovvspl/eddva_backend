import { IsString, IsNotEmpty, IsNumber, Min, Max } from 'class-validator';

export class AskAiQuestionDto {
  @IsString()
  @IsNotEmpty()
  question: string;
}

export class CompleteAiStudyDto {
  @IsNumber()
  @Min(0)
  timeSpentSeconds: number;

  @IsNotEmpty()
  highlights: any[];

  @IsNotEmpty()
  inlineComments: any[];
}

export class UpdateAiStudyNotesDto {
  @IsNotEmpty()
  highlights: any[];

  @IsNotEmpty()
  inlineComments: any[];
}

export class CompleteAiQuizDto {
  @IsNumber()
  @Min(0)
  score: number;

  @IsNumber()
  @Min(0)
  totalMarks: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  accuracy: number;

  @IsNumber()
  @Min(0)
  correctCount: number;

  @IsNumber()
  @Min(0)
  wrongCount: number;
}
