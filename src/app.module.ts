import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { redisStore } from 'cache-manager-redis-yet';

import appConfig, { jwtConfig, redisConfig, aiConfig, otpConfig, mailConfig, storageConfig } from './config/app.config';
import { dbConfig } from './config/database.config';

// ── Entities ──────────────────────────────────────────────────────────────────
import { Tenant } from './database/entities/tenant.entity';
import { User } from './database/entities/user.entity';
import { Student } from './database/entities/student.entity';
import { Subject, Chapter, Topic, TopicResource } from './database/entities/subject.entity';
import { Question, QuestionOption } from './database/entities/question.entity';
import { Batch, BatchSubjectTeacher, Enrollment } from './database/entities/batch.entity';
import {
  MockTest, TestSession, QuestionAttempt, TopicProgress,
} from './database/entities/assessment.entity';
import {
  Battle, BattleParticipant, BattleAnswer, StudentElo,
} from './database/entities/battle.entity';
import {
  Doubt, Lecture, LectureProgress, StudyPlan, PlanItem, AiStudySession,
} from './database/entities/learning.entity';
import {
  PerformanceProfile, WeakTopic, EngagementLog,
  LeaderboardEntry, Notification,
} from './database/entities/analytics.entity';
import {
  LiveSession, LiveAttendance, LiveChatMessage, LivePoll, LivePollResponse,
} from './database/entities/live-class.entity';
import { Announcement } from './database/entities/announcement.entity';
import { TeacherProfile } from './database/entities/teacher.entity';
import { PYQAttempt, PYQYearStats } from './database/entities/pyq.entity';
import { StudyMaterial } from './modules/study-material/study-material.entity';
import { ExamSyllabusCache } from './database/entities/exam-syllabus.entity';


// ── Modules ───────────────────────────────────────────────────────────────────
import { AuthModule } from './modules/auth/auth.module';
import { StudentModule } from './modules/student/student.module';
import { BattleModule } from './modules/battle/battle.module';
import { AiBridgeModule } from './modules/ai-bridge/ai-bridge.module';
import { ContentModule } from './modules/content/content.module';
import { AssessmentModule } from './modules/assessment/assessment.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DoubtModule } from './modules/doubt/doubt.module';
import { BatchModule } from './modules/batch/batch.module';
import { StudyPlanModule } from './modules/study-plan/study-plan.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { LiveClassModule } from './modules/live-class/live-class.module';
import { MailModule } from './modules/mail/mail.module';
import { InstituteSettingsModule } from './modules/institute-settings/institute-settings.module';
import { PYQModule } from './modules/pyq/pyq.module';
import { PresenceModule } from './modules/presence/presence.module';
import { StudyMaterialModule } from './modules/study-material/study-material.module';
import { AIModule } from './ai/ai.module';
import { OtpModule } from './modules/otp/otp.module';

// ── Common ────────────────────────────────────────────────────────────────────
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { UploadModule } from './modules/upload/upload.module';

const ALL_ENTITIES = [
  Tenant, User, Student,
  Subject, Chapter, Topic, TopicResource,
  Question, QuestionOption,
  Batch, BatchSubjectTeacher, Enrollment,
  MockTest, TestSession, QuestionAttempt, TopicProgress,
  Battle, BattleParticipant, BattleAnswer, StudentElo,
  Doubt, Lecture, LectureProgress, StudyPlan, PlanItem,
  PerformanceProfile, WeakTopic, EngagementLog, LeaderboardEntry, Notification,
  LiveSession, LiveAttendance, LiveChatMessage, LivePoll, LivePollResponse,
  Announcement,
  TeacherProfile,
  AiStudySession,
  PYQAttempt,
  PYQYearStats,
  StudyMaterial,
  ExamSyllabusCache,
];

@Module({
  imports: [
    // ── Config ───────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, jwtConfig, redisConfig, aiConfig, otpConfig, mailConfig, storageConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Database ──────────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const isProd = cfg.get('app.nodeEnv') === 'production';
        const dbSyncRequested = cfg.get('DB_SYNC') === 'true';
        if (isProd && dbSyncRequested) {
          throw new Error('DB_SYNC=true is forbidden in production — use migrations instead.');
        }
        return {
          ...dbConfig,
          synchronize: !isProd && dbSyncRequested,
          logging: !isProd,
          entities: ALL_ENTITIES,
        };
      },
    }),

    // ── Cache (Redis with in-memory fallback) ─────────────────────────────────
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService): Promise<any> => {
        const host = cfg.get<string>('redis.host') || 'localhost';
        const isLocal = host === 'localhost' || host === '127.0.0.1';
        if (isLocal) {
          // No local Redis — use in-memory store for development
          return { ttl: (cfg.get<number>('redis.ttl') || 3600) * 1000 };
        }
        return {
          store: await redisStore({
            socket: { host, port: cfg.get<number>('redis.port') || 6379 },
            password: cfg.get<string>('redis.password') || undefined,
            ttl: (cfg.get<number>('redis.ttl') || 3600) * 1000,
          }),
        };
      },
    }),

    // ── Rate Limiting ─────────────────────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ([{
        ttl: cfg.get<number>('app.throttle.ttl') * 1000,
        limit: cfg.get<number>('app.throttle.limit'),
      }]),
    }),

    // ── Scheduler (for cron jobs) ─────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── Bull (async job queues backed by the same Redis as the cache) ─────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        redis: {
          host: cfg.get<string>('redis.host') || 'localhost',
          port: cfg.get<number>('redis.port') || 6379,
          password: cfg.get<string>('redis.password') || undefined,
        },
      }),
    }),

    // ── Feature Modules ───────────────────────────────────────────────────────
    AuthModule,
    StudentModule,
    BattleModule,
    AiBridgeModule,
    ContentModule,
    AssessmentModule,
    NotificationModule,
    AnalyticsModule,
    DoubtModule,
    BatchModule,
    StudyPlanModule,
    SuperAdminModule,
    LiveClassModule,
    MailModule,
    InstituteSettingsModule,
    PYQModule,
    PresenceModule,
    AIModule,
    StudyMaterialModule,
    OtpModule,

    // TODO: Add as you build them:

    // Expose Tenant entity for TenantMiddleware
    TypeOrmModule.forFeature([Tenant]),

    UploadModule,
  ],
  providers: [
    // Global exception filter
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Global response wrapper
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // Global rate limiting
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply tenant resolution middleware to all routes
    consumer.apply(TenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
