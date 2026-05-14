import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

// Validate DB_SYNC safety — never allow auto-sync to run in production
if (isProd && process.env.DB_SYNC === 'true') {
  throw new Error(
    'DB_SYNC=true is forbidden in production — use migrations instead. ' +
    'Remove DB_SYNC or set it to false.',
  );
}

export const dbConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'apexiq',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  extra: {
    family: 4, // Force IPv4 — Supabase host resolves to IPv6 only by default
    // Allow up to 30 connections per process; override with DB_POOL_MAX env var
    max: parseInt(process.env.DB_POOL_MAX || '30'),
    // Idle connections released after 10 s to keep the pool lean
    idleTimeoutMillis: 10_000,
  },
  entities: [__dirname + '/../database/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
};

// Used by typeorm CLI for migration:run / migration:generate
export default new DataSource(dbConfig);
