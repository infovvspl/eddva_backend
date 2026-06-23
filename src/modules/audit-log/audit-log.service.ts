import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';

@Injectable()
export class AuditLogService implements OnModuleInit {
  constructor(
    @InjectRepository(AuditLog, 'school')
    private readonly schoolAuditLogRepo: Repository<AuditLog>,
    @InjectRepository(AuditLog, 'coaching')
    private readonly coachingAuditLogRepo: Repository<AuditLog>,
    @InjectDataSource('school') private readonly schoolDs: DataSource,
    @InjectDataSource('coaching') private readonly coachingDs: DataSource,
  ) {}

  private getRepo(connection: 'school' | 'coaching' = 'school'): Repository<AuditLog> {
    return connection === 'coaching' ? this.coachingAuditLogRepo : this.schoolAuditLogRepo;
  }

  async onModuleInit() {
    // 1. Ensure tables and columns exist on both databases
    await this.ensureColumns(this.schoolDs);
    await this.ensureColumns(this.coachingDs);
    // 2. Remove misrouted entries from school DB BEFORE stamping
    //    All genuine school audit entries have an institute_id.
    //    Rows with NULL institute_id in the school DB were coaching super-admin
    //    actions that were incorrectly written here before the interceptor fix.
    await this.cleanMisroutedSchoolEntries();
    // 3. Stamp remaining rows with the correct vertical label
    await this.stampVerticals();
  }

  /** Ensure the audit_logs table and all required columns exist. */
  private async ensureColumns(ds: DataSource) {
    try {
      await ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
      await ds.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id uuid NOT NULL DEFAULT uuid_generate_v4(),
          institute_id character varying(255),
          user_id character varying(255),
          user_name character varying(255),
          role character varying(50),
          module character varying(100) NOT NULL,
          action character varying(100) NOT NULL,
          description text,
          ip_address character varying(45),
          status character varying(20) NOT NULL,
          vertical character varying(20),
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_audit_logs" PRIMARY KEY (id)
        )
      `);
      await ds.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS institute_id character varying(255)`);
      // Add vertical column as nullable first so we can set values before making it NOT NULL
      await ds.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS vertical character varying(20)`);
    } catch (err) {
      console.error(`[AuditLog] Failed to ensure columns on ${ds.name}:`, err.message);
    }
  }

  /** Remove entries from the school DB that have NULL institute_id.
   *  All genuine school actions are associated with an institute.
   *  Any NULL institute_id rows in school DB are coaching super-admin
   *  actions that were mis-routed before the interceptor was fixed. */
  private async cleanMisroutedSchoolEntries() {
    try {
      // Use raw query for DELETE ... RETURNING to get accurate count
      const deleted = await this.schoolDs.query(
        `DELETE FROM audit_logs WHERE institute_id IS NULL RETURNING id`
      );
      const count = Array.isArray(deleted) ? deleted.length : 0;
      if (count > 0) {
        console.log(`[AuditLog] Removed ${count} misrouted coaching entry(ies) from school DB`);
      }
    } catch (err) {
      console.warn('[AuditLog] Could not clean misrouted entries:', err.message);
    }
  }

  /** Stamp all existing rows with their correct vertical based on which DB they live in. */
  private async stampVerticals() {
    try {
      await this.schoolDs.query(`UPDATE audit_logs SET vertical = 'school' WHERE vertical IS NULL OR vertical = ''`);
      await this.coachingDs.query(`UPDATE audit_logs SET vertical = 'coaching' WHERE vertical IS NULL OR vertical = ''`);
    } catch (err) {
      console.warn('[AuditLog] Could not stamp verticals:', err.message);
    }
  }

  async log(
    userId: string | null,
    userName: string | null,
    role: string | null,
    module: string,
    action: string,
    description: string | null,
    ipAddress: string | null,
    status: 'Success' | 'Failure',
    instituteId?: string | null,
    connection: 'school' | 'coaching' = 'school',
  ): Promise<AuditLog> {
    const repo = this.getRepo(connection);
    const auditLog = repo.create({
      userId,
      userName,
      role,
      module,
      action,
      description,
      ipAddress,
      status,
      instituteId,
      vertical: connection,
    });
    return repo.save(auditLog);
  }

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      startDate?: string;
      endDate?: string;
      module?: string;
      userId?: string;
      instituteId?: string;
    },
    connection: 'school' | 'coaching' = 'school',
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    const repo = this.getRepo(connection);
    const qb = repo.createQueryBuilder('log');

    // Always filter by vertical to guarantee data isolation between school and coaching.
    // This prevents any historically misrouted rows from leaking across verticals.
    qb.andWhere('log.vertical = :vertical', { vertical: connection });

    if (query.userId) {
      qb.andWhere('log.userId = :userId', { userId: query.userId });
    }

    if (query.instituteId) {
      qb.andWhere('log.instituteId = :instituteId', { instituteId: query.instituteId });
    }

    if (query.module) {
      qb.andWhere('log.module = :module', { module: query.module });
    }

    if (query.search) {
      qb.andWhere(
        '(log.userName ILIKE :search OR log.action ILIKE :search OR log.description ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.startDate) {
      qb.andWhere('log.createdAt >= :startDate', { startDate: new Date(query.startDate) });
    }

    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      qb.andWhere('log.createdAt <= :endDate', { endDate: end });
    }

    qb.orderBy('log.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }
}
