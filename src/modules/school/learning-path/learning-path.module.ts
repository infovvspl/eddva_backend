import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { LEARNING_PATH_QUEUE } from './learning-path.constants';
import { LearningPathController } from './learning-path.controller';
import { LearningPathSettingsService } from './common/learning-path-settings.service';
import { StudentCurriculumRepository } from './common/student-curriculum.repository';
import { EvidenceIngestorService } from './evidence/evidence-ingestor.service';
import { MasteryService } from './mastery/mastery.service';
import { MasteryQueryService } from './mastery/mastery-query.service';
import { LearningPathQueueService } from './jobs/learning-path-queue.service';
import { LearningPathProcessor } from './jobs/learning-path.processor';
import { LearningPathScheduler } from './jobs/learning-path.scheduler';
import { AiNotesService } from './notes/ai-notes.service';
import { QuizEngineService } from './quiz/quiz-engine.service';
import { LearningEventsService } from './common/learning-events.service';
import { ThreadStore } from './threads/thread-store';
import { TopicVideosService } from './threads/topic-videos.service';
import { LearningThreadService } from './threads/learning-thread.service';
import { ThreadChatService } from './threads/thread-chat.service';
import { SchoolTextbookModule } from '../textbook/school-textbook.module';
import { ActivityService } from './activity/activity.service';
import { LearningHomeService } from './home/learning-home.service';
import { RoadmapService } from './roadmap/roadmap.service';
import { LearningReportsController } from './reports/learning-reports.controller';
import { LearningReportService } from './reports/learning-report.service';
import { ReportScopeService } from './reports/report-scope.service';
import { LearningAlertsService } from './reports/learning-alerts.service';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

/**
 * AI learning path (replaces school/study-plan).
 * Phase 1: evidence ingestion and the mastery engine (weak topics and chapters).
 * Phase 2: the notes engine and the server-graded quiz / assessment engine.
 * Phase 3: learning threads (one chat per node, the curved path, resume, chat).
 */
@Module({
  imports: [
    AiBridgeModule,
    SchoolTextbookModule,
    BullModule.registerQueue({ name: LEARNING_PATH_QUEUE }),
    SchoolNotificationModule,
    SchoolNotificationFcmModule,
  ],
  controllers: [LearningPathController, LearningReportsController],
  providers: [
    StudentCurriculumRepository,
    LearningPathSettingsService,
    EvidenceIngestorService,
    MasteryService,
    MasteryQueryService,
    LearningPathQueueService,
    LearningPathProcessor,
    LearningPathScheduler,
    AiNotesService,
    QuizEngineService,
    LearningEventsService,
    ThreadStore,
    TopicVideosService,
    LearningThreadService,
    ThreadChatService,
    ActivityService,
    LearningHomeService,
    ReportScopeService,
    LearningReportService,
    LearningAlertsService,
    RoadmapService,
  ],
  exports: [
    MasteryService,
    LearningPathQueueService,
    LearningPathSettingsService,
    StudentCurriculumRepository,
    AiNotesService,
    QuizEngineService,
  ],
})
export class LearningPathModule {}
