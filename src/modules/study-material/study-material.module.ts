import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StudyMaterial } from './study-material.entity';
import { StudyMaterialService } from './study-material.service';
import {
  StudyMaterialAdminController,
  StudyMaterialPublicController,
} from './study-material.controller';
import { UploadModule } from '../upload/upload.module';
import { Enrollment } from '../../database/entities/batch.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([StudyMaterial, Enrollment]),
    UploadModule, // provides S3Service
  ],
  controllers: [StudyMaterialAdminController, StudyMaterialPublicController],
  providers:   [StudyMaterialService],
  exports:     [StudyMaterialService],
})
export class StudyMaterialModule {}
