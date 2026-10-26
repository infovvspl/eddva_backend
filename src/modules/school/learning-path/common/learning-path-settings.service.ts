import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MasteryConfig, resolveMasteryConfig } from '../engine/mastery-config';

const CACHE_TTL_MS = 5 * 60 * 1000;

/** Per-institute engine config, cached briefly because every recompute job reads it. */
@Injectable()
export class LearningPathSettingsService {
  private readonly cache = new Map<string, { config: MasteryConfig; expiresAt: number }>();

  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async getMasteryConfig(instituteId: string | null): Promise<MasteryConfig> {
    if (!instituteId) return resolveMasteryConfig();
    const cached = this.cache.get(instituteId);
    if (cached && cached.expiresAt > Date.now()) return cached.config;

    const rows = await this.ds.query(
      `SELECT config FROM learning_path_settings WHERE institute_id::text = $1::text`,
      [instituteId],
    );
    const config = resolveMasteryConfig(rows[0]?.config?.mastery);
    this.cache.set(instituteId, { config, expiresAt: Date.now() + CACHE_TTL_MS });
    return config;
  }
}
