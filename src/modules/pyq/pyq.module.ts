import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';

import { Question, QuestionOption } from '../../database/entities/question.entity';
import { Topic, Chapter, Subject } from '../../database/entities/subject.entity';
import { Student } from '../../database/entities/student.entity';
import { PYQAttempt, PYQYearStats } from '../../database/entities/pyq.entity';
import { AiBridgeModule } from '../ai-bridge/ai-bridge.module';

import { PYQService } from './pyq.service';
import { PYQAdminController } from './pyq-admin.controller';
import { PYQStudentController } from './pyq-student.controller';

@Module({
  imports: [
    AiBridgeModule,
    MulterModule.register({ limits: { fileSize: 10 * 1024 * 1024 } }), // 10 MB
    TypeOrmModule.forFeature([
      Question,
      QuestionOption,
      Topic,
      Chapter,
      Subject,
      Student,
      PYQAttempt,
      PYQYearStats,
    ]),
  ],
  controllers: [PYQAdminController, PYQStudentController],
  providers: [PYQService],
  exports: [PYQService],
})
export class PYQModule {}
