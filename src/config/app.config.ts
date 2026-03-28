import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 3000,
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL) || 60,
    limit: parseInt(process.env.THROTTLE_LIMIT) || 100,
  },
}));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'dev-secret-change-me',
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
}));

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  ttl: parseInt(process.env.REDIS_TTL) || 3600,
}));

export const aiConfig = registerAs('ai', () => ({
  baseUrl: process.env.AI_BASE_URL || 'http://localhost:8000',
  apiKey: process.env.AI_API_KEY || 'apexiq-dev-secret-key-2026',
  timeoutMs: parseInt(process.env.AI_TIMEOUT_MS) || 30000,
}));

export const otpConfig = registerAs('otp', () => ({
  expiresInSeconds: parseInt(process.env.OTP_EXPIRES_IN_SECONDS) || 300,
  length: parseInt(process.env.OTP_LENGTH) || 6,
  devMode: process.env.OTP_DEV_MODE === 'true',
}));

export const mailConfig = registerAs('mail', () => ({
  host: process.env.MAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.MAIL_PORT) || 587,
  secure: process.env.MAIL_SECURE === 'true',
  user: process.env.MAIL_USER || '',
  pass: process.env.MAIL_PASS || '',
  from: process.env.MAIL_FROM || 'EDVA Platform <noreply@edva.in>',
  devMode: process.env.MAIL_DEV_MODE !== 'false', // default true in dev
}));

export const storageConfig = registerAs('storage', () => ({
  provider: process.env.STORAGE_PROVIDER || 'r2',
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME || 'apexiq-media',
    publicUrl: process.env.R2_PUBLIC_URL || 'https://media.apexiq.in',
  },
}));
