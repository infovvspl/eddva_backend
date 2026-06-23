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
    await this.ensureTableExists(this.schoolDs);
    await this.ensureTableExists(this.coachingDs);
  }

  private async ensureTableExists(ds: DataSource) {
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
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_audit_logs" PRIMARY KEY (id)
        )
      `);
      await ds.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS institute_id character varying(255)`);
    } catch (err) {
      console.error(`Failed to ensure audit_logs table exists on database connection ${ds.name}:`, err);
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
