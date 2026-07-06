import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TicketRecipientType {
  SUPER_ADMIN = 'SUPER_ADMIN',
  INSTITUTE_ADMIN = 'INSTITUTE_ADMIN',
}

export class CreateCoachingSupportTicketDto {
  @ApiProperty({ description: 'Subject or title of the ticket' })
  @IsString()
  @IsNotEmpty({ message: 'Subject is required' })
  subject: string;

  @ApiProperty({ description: 'Detailed description of the issue or request' })
  @IsString()
  @IsNotEmpty({ message: 'Description is required' })
  description: string;

  @ApiProperty({ description: 'Category of the ticket' })
  @IsString()
  @IsNotEmpty({ message: 'Category is required' })
  category: string;

  @ApiProperty({ enum: TicketPriority, default: TicketPriority.MEDIUM })
  @IsEnum(TicketPriority, { message: 'Invalid priority level' })
  @IsOptional()
  priority?: TicketPriority;

  @ApiPropertyOptional({ enum: TicketRecipientType })
  @IsEnum(TicketRecipientType)
  @IsOptional()
  recipientType?: TicketRecipientType;

  @ApiPropertyOptional({ description: 'Specific institute ID (Super Admin override only)' })
  @IsOptional()
  @IsUUID()
  instituteId?: string;

  @ApiPropertyOptional({ description: 'Optional list of attachment file metadata or URLs' })
  @IsOptional()
  @IsArray()
  attachments?: any[];
}
