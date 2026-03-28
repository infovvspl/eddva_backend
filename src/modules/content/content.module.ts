import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ContentController } from './content.controller';
import { ContentService } from './content.service';

import { Subject, Chapter, Topic } from '../../database/entities/subject.entity';
import { Question, QuestionOption } from '../../database/entities/question.entity';
import { Lecture, LectureProgress, AiStudySession } from '../../database/entities/learning.entity';
import { Batch, BatchSubjectTeacher, Enrollment } from '../../database/entities/batch.entity';
import { MockTest, TopicProgress } from '../../database/entities/assessment.entity';
import { PlanItem, StudyPlan } from '../../database/entities/learning.entity';
import { Student } from '../../database/entities/student.entity';
import { AiBridgeModule } from '../ai-bridge/ai-bridge.module';

@Module({
    imports: [
        AiBridgeModule,
        TypeOrmModule.forFeature([
            Subject,
            Chapter,
            Topic,
            Question,
            QuestionOption,
            Lecture,
            LectureProgress,
            AiStudySession,
            Batch,
            BatchSubjectTeacher,
            Enrollment,
            MockTest,
            TopicProgress,
            StudyPlan,
            PlanItem,
            Student,
        ]),
    ],
    controllers: [ContentController],
    providers: [ContentService],
    exports: [ContentService],
})
export class ContentModule { }
