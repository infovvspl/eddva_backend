import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../../database/entities/tenant.entity';
import { User } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';
import { Lecture } from '../../database/entities/learning.entity';
import { Batch, BatchSubjectTeacher, Enrollment } from '../../database/entities/batch.entity';
import { InstituteSettingsController } from './institute-settings.controller';
import { AcademicCalendarController } from './academic-calendar.controller';
import { InstituteSettingsService } from './institute-settings.service';
import { CalendarFeedService } from './calendar-feed.service';
import { UploadModule } from '../upload/upload.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      User,
      Student,
      Lecture,
      Enrollment,
      Batch,
      BatchSubjectTeacher,
    ]),
    UploadModule,
    NotificationModule,
  ],
  controllers: [InstituteSettingsController, AcademicCalendarController],
  providers: [InstituteSettingsService, CalendarFeedService],
})
export class InstituteSettingsModule {}