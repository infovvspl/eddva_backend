import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ContentController } from './content.controller';
import { ContentService } from './content.service';

import { Subject, Chapter, Topic, TopicResource } from '../../database/entities/subject.entity';
import { Question, QuestionOption } from '../../database/entities/question.entity';
import { Lecture, LectureProgress, AiStudySession } from '../../database/entities/learning.entity';
import { Batch, BatchSubjectTeacher, Enrollment } from '../../database/entities/batch.entity';
import { User } from '../../database/entities/user.entity';
import { MockTest, TopicProgress } from '../../database/entities/assessment.entity';
import { PlanItem, StudyPlan } from '../../database/entities/learning.entity';
import { Student } from '../../database/entities/student.entity';
import { AiBridgeModule } from '../ai-bridge/ai-bridge.module';
import { UploadModule } from '../upload/upload.module';
import { NotificationModule } from '../notification/notification.module';
import { StudyMaterial } from '../study-material/study-material.entity';

@Module({
    imports: [
        AiBridgeModule,
        UploadModule,
        NotificationModule,
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
            User,
            TopicResource,
            StudyMaterial,
        ]),
    ],
    controllers: [ContentController],
    providers: [ContentService],
    exports: [ContentService],
})
export class ContentModule { }
