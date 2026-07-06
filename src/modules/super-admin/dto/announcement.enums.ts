import { IsEnum, IsOptional } from 'class-validator';

export enum AnnouncementCategory {
  GENERAL = 'GENERAL',
  ACADEMIC = 'ACADEMIC',
  ADMINISTRATIVE = 'ADMINISTRATIVE',
  MAINTENANCE = 'MAINTENANCE',
  EMERGENCY = 'EMERGENCY',
}

export enum AnnouncementPriority {
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}
