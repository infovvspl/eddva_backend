import { APP_ACTIVITY_CATEGORIES, AppActivityCategory } from './app-activity-credit';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AppHeartbeatDto {
  @IsIn(APP_ACTIVITY_CATEGORIES as unknown as string[])
  category: AppActivityCategory;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  refId?: string;

  /** Active seconds counted by the client since its previous heartbeat; several when replaying an offline queue. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(60, { each: true })
  beats: number[];

  @IsOptional()
  @IsIn(['web', 'mobile', 'tablet'])
  device?: string;
}
