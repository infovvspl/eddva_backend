import { IsString, IsInt, IsUUID, IsIn, Min, ValidateIf } from 'class-validator';

export const HIGHLIGHT_COLORS = [
  'yellow', '#fef08a',
  'green', '#bbf7d0',
  'blue', '#bfdbfe',
  'pink', '#fbcfe8',
  'orange', '#fed7aa'
] as const;

export class CreateHighlightDto {
  @IsInt()
  @Min(0)
  startOffset: number;

  @IsInt()
  @Min(1)
  endOffset: number;

  @IsString()
  text: string;

  @IsString()
  @IsIn(HIGHLIGHT_COLORS)
  color: string;
  
  @IsString()
  @ValidateIf((o) => o.notesHash !== undefined)
  notesHash?: string;
}
