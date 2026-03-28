import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SuperAdminController } from './super-admin.controller';
import { PublicTenantController } from './public-tenant.controller';
import { SuperAdminService } from './super-admin.service';

import { Tenant } from '../../database/entities/tenant.entity';
import { User } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';
import { Batch, Enrollment } from '../../database/entities/batch.entity';
import { Lecture } from '../../database/entities/learning.entity';
import { TestSession } from '../../database/entities/assessment.entity';
import { Announcement } from '../../database/entities/announcement.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    NotificationModule,
    TypeOrmModule.forFeature([Tenant, User, Student, Batch, Lecture, TestSession, Enrollment, Announcement]),
  ],
  controllers: [SuperAdminController, PublicTenantController],
  providers: [SuperAdminService],
})
export class SuperAdminModule {}
