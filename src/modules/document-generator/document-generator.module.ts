import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentGeneratorController } from './document-generator.controller';
import { DocumentGeneratorService } from './document-generator.service';
import { SchoolDocumentTemplate } from '../school/entities/school-document-template.entity';
import { SchoolDocumentGenerationHistory } from '../school/entities/school-document-generation-history.entity';
import { IdCardRecord } from '../school/entities/id-card-record.entity';
import { SchoolStudent } from '../school/entities/school-student.entity';
import { SchoolUser } from '../school/entities/school-user.entity';
import { TeacherProfile } from '../../database/entities/teacher.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SchoolDocumentTemplate, 
      SchoolDocumentGenerationHistory,
      IdCardRecord,
      SchoolStudent,
      SchoolUser
    ], 'school'),
    TypeOrmModule.forFeature([TeacherProfile], 'coaching'),
  ],
  controllers: [DocumentGeneratorController],
  providers: [DocumentGeneratorService],
  exports: [DocumentGeneratorService],
})
export class DocumentGeneratorModule {}
