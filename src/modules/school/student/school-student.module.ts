import { Module } from '@nestjs/common';
import { SchoolStudentService } from './school-student.service';
import { SchoolStudentController } from './school-student.controller';
import { SchoolUserController } from './school-user.controller';
import { SchoolStudentExitService } from './school-student-exit.service';
import { SchoolStudentExitController } from './school-student-exit.controller';
import { DocumentGeneratorModule } from '../../document-generator/document-generator.module';
import { UploadModule } from '../../upload/upload.module';

@Module({
  imports: [DocumentGeneratorModule, UploadModule],
  controllers: [
    SchoolStudentController,
    SchoolUserController,
    SchoolStudentExitController,
  ],
  providers: [
    SchoolStudentService,
    SchoolStudentExitService,
  ],
  exports: [
    SchoolStudentService,
    SchoolStudentExitService,
  ],
})
export class SchoolStudentModule {}
