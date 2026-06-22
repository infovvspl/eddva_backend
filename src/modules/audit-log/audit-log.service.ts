import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog, 'school')
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

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
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepo.create({
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
    return this.auditLogRepo.save(auditLog);
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    startDate?: string;
    endDate?: string;
    module?: string;
    userId?: string;
    instituteId?: string;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    const qb = this.auditLogRepo.createQueryBuilder('log');

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
