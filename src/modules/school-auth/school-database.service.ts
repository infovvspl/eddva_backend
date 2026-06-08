import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class SchoolDatabaseService implements OnModuleDestroy {
  private readonly pool: Pool | null;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('SCHOOL_DB_URL')?.trim();
    this.pool = url
      ? new Pool({
          connectionString: url,
          ssl: { rejectUnauthorized: false },
          max: parseInt(this.configService.get<string>('SCHOOL_DB_POOL_MAX') || '10', 10),
        })
      : null;
  }

  isConfigured(): boolean {
    return this.pool !== null;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new Error('SCHOOL_DB_URL is not configured');
    }
    return this.pool.query<T>(text, params);
  }

  async onModuleDestroy() {
    await this.pool?.end().catch(() => undefined);
  }
}
