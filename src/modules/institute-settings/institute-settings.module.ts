import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../../database/entities/tenant.entity';
import { User } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';
import { InstituteSettingsController } from './institute-settings.controller';
import { InstituteSettingsService } from './institute-settings.service';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, User, Student]),
    UploadModule,
  ],
  controllers: [InstituteSettingsController],
  providers: [InstituteSettingsService],
})
export class InstituteSettingsModule {}