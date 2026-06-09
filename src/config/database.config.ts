import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';
const defaultDbPoolMax = isProd ? '5' : '1';

if (isProd && process.env.DB_SYNC === 'true') {
  throw new Error(
    'DB_SYNC=true is forbidden in production — use migrations instead. ' +
    'Remove DB_SYNC or set it to false.',
  );
}

// ── Coaching DB (primary, named 'coaching') ─────────────────────────────────
export const coachingDbConfig: DataSourceOptions = {
  name: 'coaching',
  type: 'postgres',
  url: process.env.COACHING_DB_URL,
  host: !process.env.COACHING_DB_URL ? (process.env.DB_HOST || 'localhost') : undefined,
  port: !process.env.COACHING_DB_URL ? (parseInt(process.env.DB_PORT) || 5432) : undefined,
  username: !process.env.COACHING_DB_URL ? (process.env.DB_USERNAME || 'postgres') : undefined,
  password: !process.env.COACHING_DB_URL ? (process.env.DB_PASSWORD || 'postgres') : undefined,
  database: !process.env.COACHING_DB_URL ? (process.env.DB_NAME || 'apexiq') : undefined,
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  ssl: { rejectUnauthorized: false },
  extra: {
    family: 4,
    max: parseInt(process.env.DB_POOL_MAX || defaultDbPoolMax),
    // Keep connections warm: avoid the ~1.2s TLS reconnect on every short idle gap
    // (the dominant latency cost when running locally against RDS in Mumbai).
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '300000'), // 5 min
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  },
  entities: [__dirname + '/../database/entities/*.entity{.ts,.js}',
             __dirname + '/../modules/**/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
};

// ── School DB (secondary, named 'school') ───────────────────────────────────
export const schoolDbConfig: DataSourceOptions = {
  name: 'school',
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  ssl: { rejectUnauthorized: false },
  extra: {
    family: 4,
    max: parseInt(process.env.SCHOOL_DB_POOL_MAX || defaultDbPoolMax),
    // Keep connections warm to avoid the ~1.2s TLS reconnect on short idle gaps.
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '300000'), // 5 min
    connectionTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  },
  entities: [__dirname + '/../modules/school/**/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../modules/school/migrations/*{.ts,.js}'],
  migrationsTableName: 'school_migrations',
};

// Legacy alias kept for typeorm CLI (coaching DB)
export const dbConfig = coachingDbConfig;

// Used by typeorm CLI for coaching migrations
export default new DataSource({ ...coachingDbConfig, name: 'default' } as DataSourceOptions);
