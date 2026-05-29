import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { SuperAdminController } from './super-admin.controller';
import { PublicTenantController } from './public-tenant.controller';
import { SuperAdminService } from './super-admin.service';
import { PlatformSuperAdminController } from './platform-super-admin.controller';
import { PlatformSuperAdminService } from './platform-super-admin.service';
import { SchoolSuperAdminController } from './school-super-admin.controller';
import { SchoolSuperAdminService } from './school-super-admin.service';

import { Tenant } from '../../database/entities/tenant.entity';
import { User } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';
import { Batch, Enrollment } from '../../database/entities/batch.entity';
import { Lecture } from '../../database/entities/learning.entity';
import { TestSession } from '../../database/entities/assessment.entity';
import { Announcement } from '../../database/entities/announcement.entity';
import { StudyMaterial } from '../study-material/study-material.entity';
import { NotificationModule } from '../notification/notification.module';
import { StudyMaterialModule } from '../study-material/study-material.module';

@Module({
  imports: [
    NotificationModule,
    StudyMaterialModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
        signOptions: { expiresIn: cfg.get<string>('jwt.expiresIn') },
      }),
    }),
    TypeOrmModule.forFeature([Tenant, User, Student, Batch, Enrollment, Lecture, TestSession, Announcement, StudyMaterial], 'coaching'),
  ],
  controllers: [SuperAdminController, PublicTenantController, PlatformSuperAdminController, SchoolSuperAdminController],
  providers: [SuperAdminService, PlatformSuperAdminService, SchoolSuperAdminService],
})
export class SuperAdminModule {}
