import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class GetTokenDto {
  @IsUUID()
  @ApiProperty()
  lectureId: string;

  @IsIn(['host', 'audience'])
  @ApiProperty({ enum: ['host', 'audience'] })
  role: 'host' | 'audience';
}

export class CreatePollDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'What is the efficiency of Carnot engine?' })
  question: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @ApiProperty({ example: ['25%', '50%', '75%', '100%'] })
  options: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ description: 'Index of correct option (0-based)' })
  correctOptionIndex?: number;
}

export class PollRespondDto {
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Index of selected option (0-based)' })
  selectedOption: number;
}

export class ChatHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({ default: 1 })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({ default: 20 })
  limit?: number = 20;
}
