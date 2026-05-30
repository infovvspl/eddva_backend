import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @InjectDataSource('coaching')
    private readonly ds: DataSource,
  ) {}

  private async findTenant(where: string, param: string): Promise<Tenant | null> {
    try {
      const rows = await this.ds.query(
        `SELECT id, name, subdomain, type, status, plan, max_students, max_teachers FROM tenants WHERE ${where} = $1 LIMIT 1`,
        [param],
      );
      if (!rows.length) return null;
      const r = rows[0];
      return Object.assign(new Tenant(), {
        id: r.id, name: r.name, subdomain: r.subdomain,
        type: r.type, status: r.status, plan: r.plan,
        maxStudents: r.max_students, maxTeachers: r.max_teachers,
      });
    } catch {
      return null;
    }
  }

  async use(req: Request & { tenantId?: string; tenant?: Tenant }, res: Response, next: NextFunction) {
    let tenant: Tenant | null = null;

    const headerTenantId = req.headers['x-tenant-id'] as string;
    if (headerTenantId) tenant = await this.findTenant('id', headerTenantId);

    if (!tenant) {
      const headerSubdomain = req.headers['x-tenant-subdomain'] as string;
      if (headerSubdomain) tenant = await this.findTenant('subdomain', headerSubdomain);
    }

    if (!tenant) {
      const host = req.hostname;
      const parts = host.split('.');
      if (parts.length === 2 && parts[1] === 'localhost') {
        tenant = await this.findTenant('subdomain', parts[0]);
      } else if (parts.length >= 3) {
        tenant = await this.findTenant('subdomain', parts[0]);
      }
    }

    if (!tenant) {
      const authHeader = req.headers['authorization'] as string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const payloadB64 = authHeader.slice(7).split('.')[1];
          if (payloadB64) {
            const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { tenantId?: string };
            if (decoded.tenantId) tenant = await this.findTenant('id', decoded.tenantId);
          }
        } catch { /* ignore */ }
      }
    }

    if (!tenant) tenant = await this.findTenant('subdomain', 'platform');

    if (!tenant) return next();

    if (tenant.status === TenantStatus.SUSPENDED) {
      throw new UnauthorizedException('This institute account has been suspended.');
    }

    req.tenantId = tenant.id;
    req.tenant = tenant;
    next();
  }
}
