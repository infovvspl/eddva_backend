import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTicketMessageDto {
  @ApiProperty({ description: 'Message body content' })
  @IsString()
  @IsNotEmpty({ message: 'Message content is required' })
  content: string;

  @ApiPropertyOptional({ description: 'Optional attachment files or metadata' })
  @IsOptional()
  @IsArray()
  attachments?: any[];
}
