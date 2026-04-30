import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { AppModule } from './app.module';

// Load env files early with override so .env.local always wins over .env and process.env
for (const file of ['.env', '.env.local']) {
  if (existsSync(file)) dotenv.config({ path: file, override: true });
}
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // ── Static file serving for uploads ───────────────────────────────────────
  mkdirSync(join(__dirname, '..', 'uploads', 'avatars'), { recursive: true });
  mkdirSync(join(__dirname, '..', 'uploads', 'videos'), { recursive: true });
  mkdirSync(join(__dirname, '..', 'uploads', 'thumbnails'), { recursive: true });
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' });

  const cfg = app.get(ConfigService);

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

  const port = cfg.get<number>('app.port') || 3000;
  await app.listen(port);

  logger.log(`🚀 APEXIQ API running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`📡 WebSocket (Battle Arena): ws://localhost:${port}/battle`);
  logger.log(`🌍 Environment: ${cfg.get('app.nodeEnv')}`);
}

bootstrap();
