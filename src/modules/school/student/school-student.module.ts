import { Module } from '@nestjs/common';
import { SchoolStudentService } from './school-student.service';
import { SchoolStudentController } from './school-student.controller';

import { SchoolUserController } from './school-user.controller';

@Module({
  controllers: [SchoolStudentController, SchoolUserController],
  providers: [SchoolStudentService],
})
export class SchoolStudentModule {}
