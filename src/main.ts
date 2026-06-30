import { NestFactory, Reflector } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import * as dotenv from 'dotenv';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { seedSuperAdmin } from './database/seeds/super-admin.seeder';

// Load env files early with override so .env.local always wins over .env and process.env
for (const file of ['.env', '.env.local']) {
  if (existsSync(file)) dotenv.config({ path: file, override: true });
}
// Trigger restart
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // ── Static file serving for uploads ───────────────────────────────────────
  mkdirSync(join(__dirname, '..', 'uploads'), { recursive: true });
  mkdirSync(join(__dirname, '..', 'uploads', 'avatars'), { recursive: true });
  mkdirSync(join(__dirname, '..', 'uploads', 'videos'), { recursive: true });
  mkdirSync(join(__dirname, '..', 'uploads', 'thumbnails'), { recursive: true });
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' });

  const cfg = app.get(ConfigService);

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(helmet());

  // ── Gzip compression ─────────────────────────────────────────────────────
  app.use(compression());

  // ── Body size limit for video uploads ────────────────────────────────────
  app.use(require('express').json({ limit: '10mb' }));
  app.use(require('express').urlencoded({ limit: '10mb', extended: true }));

  // ── CORS ──────────────────────────────────────────────────────────────────
  const isDev = cfg.get<string>('app.nodeEnv') !== 'production';
  const explicitOrigins = (process.env.CORS_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  app.enableCors({
    origin: isDev
      ? true
      : (origin, callback) => {
          // No origin = server-to-server / same-origin — always allow
          if (!origin) return callback(null, true);
          // Any subdomain of eddva.in (http or https)
          if (/^https?:\/\/([\w-]+\.)?eddva\.in(:\d+)?$/.test(origin)) {
            return callback(null, true);
          }
          // Explicit allow-list from CORS_ORIGINS env var
          if (explicitOrigins.includes(origin)) return callback(null, true);
          callback(new Error(`CORS: origin not allowed — ${origin}`), false);
        },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'x-tenant-id',
      'x-institute-id',
      'x-api-key',
      'x-tenant-subdomain',
      'x-institute-domain',
      'x-vertical',
      'Cache-Control',
      'Pragma',
      'Expires',
      'If-Modified-Since',
    ],
    exposedHeaders: ['Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // ── Global prefix ─────────────────────────────────────────────────────────
  const apiPrefix = cfg.get<string>('app.apiPrefix') || 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  // ── Validation ────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // Strip unknown properties
      forbidNonWhitelisted: true,
      transform: true,           // Auto-transform primitives (string → number etc.)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Swagger API Docs ──────────────────────────────────────────────────────
  if (cfg.get<string>('app.nodeEnv') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('APEXIQ API')
      .setDescription(
        'APEXIQ — JEE/NEET Battle Learning Platform\n\n' +
        '**Auth:** Use `POST /auth/otp/send` → `POST /auth/otp/verify` to get access token.\n' +
        'In dev mode, OTP is always `123456`.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Auth', 'OTP login, JWT, onboarding')
      .addTag('Student', 'Dashboard, weak topics, streak')
      .addTag('Battle', 'Battle arena, ELO, matchmaking')
      .addTag('Assessment', 'Mock tests, chapter tests, results')
      .addTag('Content', 'Lectures, questions, notes')
      .addTag('Analytics', 'Leaderboard, rank prediction, performance')
      .addTag('Notification', 'Push, WhatsApp, SMS notifications')
      .addTag('AI', 'All 12 AI service endpoints via bridge')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
      },
    });
    logger.log(`Swagger docs available at: http://localhost:${cfg.get('app.port')}/docs`);
  }

  // ── Ensure all tenant columns exist (entity ↔ DB drift) ───────────────────
  try {
    const coachingDs = app.get(getDataSourceToken('coaching'));
    const tenantCols = [
      `ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
      `ADD COLUMN IF NOT EXISTS ai_features JSONB NOT NULL DEFAULT '[]'`,
      `ADD COLUMN IF NOT EXISTS logo_url VARCHAR`,
      `ADD COLUMN IF NOT EXISTS brand_color VARCHAR DEFAULT '#F97316'`,
      `ADD COLUMN IF NOT EXISTS welcome_message VARCHAR`,
      `ADD COLUMN IF NOT EXISTS city VARCHAR`,
      `ADD COLUMN IF NOT EXISTS state VARCHAR`,
      `ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE`,
      `ADD COLUMN IF NOT EXISTS billing_email VARCHAR`,
      `ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR`,
      `ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR`,
      `ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`,
      `ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE`,
      `ADD COLUMN IF NOT EXISTS suspension_reason VARCHAR`,
      `ADD COLUMN IF NOT EXISTS admin_portal_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
      `ADD COLUMN IF NOT EXISTS student_portal_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
      `ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`,
    ];
    for (const col of tenantCols) {
      await coachingDs.query(`ALTER TABLE tenants ${col}`);
    }
    // Ensure batch_feedbacks table exists (added by a later feature, table may be missing)
    await coachingDs.query(`
      CREATE TABLE IF NOT EXISTS "batch_feedbacks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "tenant_id" character varying NOT NULL,
        "batch_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "rating" integer NOT NULL,
        "comment" text,
        CONSTRAINT "UQ_batch_student_feedback" UNIQUE ("batch_id", "student_id"),
        CONSTRAINT "PK_batch_feedbacks" PRIMARY KEY ("id")
      )
    `);
    logger.log('Tenant columns + batch_feedbacks table ensured');
  } catch (err) {
    logger.warn(`Tenant column migration skipped: ${err.message}`);
  }

  // ── Seed super admin on startup ───────────────────────────────────────────
  try {
    const dataSource = app.get(getDataSourceToken('coaching'));
    await seedSuperAdmin(dataSource);
  } catch (err) {
    logger.warn(`Super admin seeder skipped: ${err.message}`);
  }

  // ── Ensure school DB has required indexes ─────────────────────────────────
  try {
    const schoolDs = app.get(getDataSourceToken('school'));
    const instituteCols = [
      `ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR`,
      `ADD COLUMN IF NOT EXISTS website VARCHAR`,
      `ADD COLUMN IF NOT EXISTS school_type VARCHAR`,
      `ADD COLUMN IF NOT EXISTS board VARCHAR`,
      `ADD COLUMN IF NOT EXISTS established_year VARCHAR`,
      `ADD COLUMN IF NOT EXISTS affiliation_no VARCHAR`,
      `ADD COLUMN IF NOT EXISTS total_classes VARCHAR`,
      `ADD COLUMN IF NOT EXISTS total_students VARCHAR`,
      `ADD COLUMN IF NOT EXISTS total_teachers VARCHAR`,
      `ADD COLUMN IF NOT EXISTS academic_session VARCHAR`,
      `ADD COLUMN IF NOT EXISTS timezone VARCHAR`,
      `ADD COLUMN IF NOT EXISTS language VARCHAR`,
      `ADD COLUMN IF NOT EXISTS currency VARCHAR`,
      `ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR`,
      `ADD COLUMN IF NOT EXISTS modules_permissions JSONB DEFAULT '{}'`,
      `ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
      `ADD COLUMN IF NOT EXISTS ai_features JSONB NOT NULL DEFAULT '{}'`,
    ];
    for (const col of instituteCols) {
      await schoolDs.query(`ALTER TABLE institutes ${col}`);
    }
    await schoolDs.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_school_users_email ON users (LOWER(email))`);
    await schoolDs.query(`CREATE INDEX IF NOT EXISTS idx_school_users_role ON users (role)`);
    await schoolDs.query(`CREATE INDEX IF NOT EXISTS idx_school_users_institute ON users (institute_id)`);
    await schoolDs.query(`CREATE INDEX IF NOT EXISTS idx_school_institutes_status ON institutes (status)`);
    await schoolDs.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await schoolDs.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_features JSONB NOT NULL DEFAULT '{"ai_doubt_solver":true,"ai_notes_generator":true,"ai_quiz_generator":true,"ai_study_planner":true,"ai_career_guidance":true}'`);
    await schoolDs.query(`UPDATE institutes SET ai_features = '{"ai_doubt_solver":true,"ai_notes_generator":true,"ai_quiz_generator":true,"ai_study_planner":true,"ai_career_guidance":true}'::jsonb WHERE ai_features = '[]'::jsonb OR ai_features = '{}'::jsonb`);
    await schoolDs.query(`ALTER TABLE institutes ADD COLUMN IF NOT EXISTS modules_permissions JSONB NOT NULL DEFAULT '{"live_classes":true,"assessments":true,"assignments":true,"chat":true}'`);
    await schoolDs.query(`UPDATE institutes SET modules_permissions = '{"live_classes":true,"assessments":true,"assignments":true,"chat":true}'::jsonb WHERE modules_permissions = '{}'::jsonb OR modules_permissions IS NULL`);
    logger.log('School DB indexes + institute columns ensured');
    
    // ── Run school DB migrations ───────────────────────────────────────────
    logger.log('Running school DB migrations...');
    await schoolDs.runMigrations();
    logger.log('School DB migrations completed');
  } catch (err) {
    logger.warn(`School DB index setup or migrations execution failed: ${err.message}`);
  }

  const port = cfg.get<number>('app.port') || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 APEXIQ API running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`📡 WebSocket (Battle Arena): ws://localhost:${port}/battle`);
  logger.log(`🌍 Environment: ${cfg.get('app.nodeEnv')}`);
}

bootstrap();

// Trigger Restart 3
