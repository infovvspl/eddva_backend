import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiveSession, LiveSessionStatus } from '../../database/entities/live-class.entity';

const ONLINE_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface PresenceRecord {
  role: string;
  tenantId: string;
  ts: number;
}

@Injectable()
export class PresenceService {
  private readonly map = new Map<string, PresenceRecord>();

  constructor(
    @InjectRepository(LiveSession)
    private readonly liveSessionRepo: Repository<LiveSession>,
  ) {}

  beat(userId: string, role: string, tenantId: string): void {
    this.map.set(userId, { role, tenantId, ts: Date.now() });
  }

  async getAdminStats(tenantId: string): Promise<{
    studentsOnline: number;
    teachersOnline: number;
    liveClassesRunning: number;
  }> {
    const now = Date.now();
    let studentsOnline = 0;
    let teachersOnline = 0;

    for (const [, v] of this.map) {
      if (v.tenantId !== tenantId || now - v.ts > ONLINE_TTL_MS) continue;
      if (v.role === 'student') studentsOnline++;
      else if (v.role === 'teacher') teachersOnline++;
    }

    const liveClassesRunning = await this.liveSessionRepo.count({
      where: { tenantId, status: LiveSessionStatus.LIVE },
    });

    return { studentsOnline, teachersOnline, liveClassesRunning };
  }

  getTeacherStats(tenantId: string): { studentsOnline: number } {
    const now = Date.now();
    let studentsOnline = 0;

    for (const [, v] of this.map) {
      if (v.tenantId !== tenantId || now - v.ts > ONLINE_TTL_MS) continue;
      if (v.role === 'student') studentsOnline++;
    }

    return { studentsOnline };
  }
}
