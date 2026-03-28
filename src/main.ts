import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // ── Static file serving for uploads ───────────────────────────────────────
  mkdirSync(join(__dirname, '..', 'uploads', 'avatars'), { recursive: true });
  mkdirSync(join(__dirname, '..', 'uploads', 'videos'), { recursive: true });
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' });

  const cfg = app.get(ConfigService);

  // ── CORS ──────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: cfg.get<string[]>('app.corsOrigins'),
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
