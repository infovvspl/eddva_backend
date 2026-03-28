import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { NotificationType } from '../../../database/entities/analytics.entity';

export enum ManualNotificationChannel {
  PUSH = 'push',
  SMS = 'sms',
  WHATSAPP = 'whatsapp',
  IN_APP = 'in_app',
}

export class NotificationListQueryDto {
  @ApiPropertyOptional({ description: 'Filter by read state' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isRead?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;
}

export class SendNotificationDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds: string[];

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  body: string;

  @ApiProperty({
    enum: ManualNotificationChannel,
    description: 'Delivery channel for this manual blast',
  })
  @IsEnum(ManualNotificationChannel)
  type: ManualNotificationChannel;

  @ApiPropertyOptional({
    enum: NotificationType,
    description: 'Optional semantic notification type. Defaults to general.',
  })
  @IsOptional()
  @IsEnum(NotificationType)
  notificationType?: NotificationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refId?: string;
}
