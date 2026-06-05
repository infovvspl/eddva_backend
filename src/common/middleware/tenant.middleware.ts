import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';

// Tenants change very rarely, but the middleware runs on EVERY request and was
// hitting the DB up to 4× per request (often for the same misses, e.g. a school
// subdomain that doesn't exist in the coaching tenants table). Cache both hits
// and misses for a short TTL to eliminate those repeated lookups.
const TENANT_CACHE = new Map<string, { tenant: Tenant | null; exp: number }>();
const TENANT_TTL_MS = 60_000;

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @InjectDataSource('coaching')
    private readonly ds: DataSource,
  ) { }

  private tenantCache = new Map<string, { value: Tenant | null; expiresAt: number }>();
  private readonly cacheTtlMs = 30000; // 30 seconds

  private async findTenant(where: string, param: string): Promise<Tenant | null> {
    const key = `${where}:${param}`;
    const cached = TENANT_CACHE.get(key);
    const now = Date.now();
    if (cached && cached.exp > now) return cached.tenant;

    let tenant: Tenant | null = null;
    try {
      const rows = await this.ds.query(
        `SELECT id, name, subdomain, type, status, plan, max_students, max_teachers FROM tenants WHERE ${where} = $1 LIMIT 1`,
        [param],
      );
      if (rows.length) {
        const r = rows[0];
        tenant = Object.assign(new Tenant(), {
          id: r.id, name: r.name, subdomain: r.subdomain,
          type: r.type, status: r.status, plan: r.plan,
          maxStudents: r.max_students, maxTeachers: r.max_teachers,
        });
      }
    } catch {
      tenant = null;
    }
    TENANT_CACHE.set(key, { tenant, exp: now + TENANT_TTL_MS });
    return tenant;
  }

  async use(req: Request & { tenantId?: string; tenant?: Tenant }, res: Response, next: NextFunction) {
    // School APIs use institutes (school DB), not coaching tenants — skip entirely.
    const rawPath = (req.originalUrl || req.url || '').toLowerCase();
    if (rawPath.includes('/school/')) {
      return next();
    }

    let tenant: Tenant | null = null;
    /** Subdomain explicitly requested via host/header but not yet resolved in DB */
    let requestedSubdomain: string | null = null;

    const headerTenantId = req.headers['x-tenant-id'] as string;
    if (headerTenantId) tenant = await this.findTenant('id', headerTenantId);

    if (!tenant) {
      const headerSubdomain = req.headers['x-tenant-subdomain'] as string;
      if (headerSubdomain) tenant = await this.findTenant('subdomain', headerSubdomain);
    }

    if (!tenant) {
      const host = req.hostname;
      const isIpHost = /^\d+\.\d+\.\d+\.\d+$/.test(host);
      if (!isIpHost) {
        const parts = host.split('.');
        const reserved = new Set(['localhost', 'www', 'edva', 'apexiq', 'platform']);
        if (parts.length === 2 && parts[1] === 'localhost') {
          const sub = parts[0].toLowerCase();
          if (!reserved.has(sub)) {
            requestedSubdomain = requestedSubdomain ?? sub;
            tenant = await this.findTenant('subdomain', sub);
          }
        } else if (parts.length >= 3) {
          const sub = parts[0].toLowerCase();
          if (!reserved.has(sub)) {
            requestedSubdomain = requestedSubdomain ?? sub;
            tenant = await this.findTenant('subdomain', sub);
          }
        }
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
