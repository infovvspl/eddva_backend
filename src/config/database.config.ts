import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';
const defaultDbPoolMax = isProd ? '20' : '5';

if (!process.env.COACHING_DB_URL) throw new Error('COACHING_DB_URL is required');
if (!process.env.SCHOOL_DB_URL)   throw new Error('SCHOOL_DB_URL is required');

if (isProd && process.env.DB_SYNC === 'true') {
  throw new Error(
    'DB_SYNC=true is forbidden in production — use migrations instead.',
  );
}

// ── Coaching DB (primary, named 'coaching') ─────────────────────────────────
export const coachingDbConfig: DataSourceOptions = {
  name: 'coaching',
  type: 'postgres',
  url: process.env.COACHING_DB_URL,
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  ssl: { rejectUnauthorized: false },
  extra: {
    max: parseInt(process.env.DB_POOL_MAX || defaultDbPoolMax),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '300000'),
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
    max: parseInt(process.env.SCHOOL_DB_POOL_MAX || defaultDbPoolMax),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '300000'),
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
