import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 3000,
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL) || 60,
    limit: parseInt(process.env.THROTTLE_LIMIT) || 100,
  },
}));

export const jwtConfig = registerAs('jwt', () => {
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;

  if (isProd && !secret) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  if (isProd && !refreshSecret) {
    throw new Error('JWT_REFRESH_SECRET environment variable is required in production');
  }

  return {
    secret: secret || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: refreshSecret || 'dev-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  };
});

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  ttl: parseInt(process.env.REDIS_TTL) || 3600,
}));

export const aiConfig = registerAs('ai', () => ({
  baseUrl: process.env.AI_BASE_URL || 'http://localhost:8000',
  apiKey: process.env.AI_API_KEY || 'apexiq-dev-secret-key-2026',
  // 4 minutes default to support multi-segment mock-test generation.
  timeoutMs: parseInt(process.env.AI_TIMEOUT_MS) || 240000,
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
  provider: process.env.STORAGE_PROVIDER || 's3',

  s3: {
    region:          process.env.AWS_REGION          || 'ap-south-1',
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucketName:      process.env.S3_BUCKET_NAME      || 'eddva-assets',
    publicUrl:       process.env.S3_PUBLIC_URL        || '',   // CDN origin (CloudFront)
    presignExpiresIn: parseInt(process.env.S3_PRESIGN_TTL || '600'), // 10 min
  },

  // Cloudflare R2 (S3-compatible, kept for legacy)
  r2: {
    accountId:       process.env.R2_ACCOUNT_ID,
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName:      process.env.R2_BUCKET_NAME || 'apexiq-media',
    publicUrl:       process.env.R2_PUBLIC_URL  || 'https://media.apexiq.in',
  },
}));
