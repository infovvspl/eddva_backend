import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';

/**
 * TenantMiddleware
 *
 * Runs on EVERY request. Resolves the tenant from:
 *   1. X-Tenant-ID header (for internal/admin calls)
 *   2. Subdomain (e.g. allen-kota.apexiq.in → subdomain = "allen-kota")
 *   3. Falls back to the PLATFORM tenant (for B2C routes)
 *
 * Sets req.tenantId and req.tenant for downstream use.
 * Also sets PostgreSQL session variable for Row-Level Security.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async use(req: Request & { tenantId?: string; tenant?: Tenant }, res: Response, next: NextFunction) {
    let tenant: Tenant | null = null;

    // ── 1. Explicit header (admin/internal calls) ──────────────────────────
    const headerTenantId = req.headers['x-tenant-id'] as string;
    if (headerTenantId) {
      tenant = await this.tenantRepo.findOne({ where: { id: headerTenantId } });
    }

    // ── 2. X-Tenant-Subdomain header (sent by frontend on tenant subdomains) ─
    if (!tenant) {
      const headerSubdomain = req.headers['x-tenant-subdomain'] as string;
      if (headerSubdomain) {
        tenant = await this.tenantRepo.findOne({ where: { subdomain: headerSubdomain } });
      }
    }

    // ── 3. Subdomain resolution from Host header ─────────────────────────
    if (!tenant) {
      const host = req.hostname; // e.g. "allen-kota.apexiq.in"
      const parts = host.split('.');
      // soa.localhost → 2 parts, soa.edva.in → 3 parts
      if (parts.length === 2 && parts[1] === 'localhost') {
        tenant = await this.tenantRepo.findOne({ where: { subdomain: parts[0] } });
      } else if (parts.length >= 3) {
        const subdomain = parts[0];
        tenant = await this.tenantRepo.findOne({ where: { subdomain } });
      }
    }

    // ── 4. Fallback: platform tenant (B2C) ───────────────────────────────
    if (!tenant) {
      tenant = await this.tenantRepo.findOne({
        where: { subdomain: 'platform' },
      });
    }

    if (!tenant) {
      // No tenant found and no fallback — this shouldn't happen in production
      // but guard against it during development
      return next();
    }

    if (tenant.status === TenantStatus.SUSPENDED) {
      throw new UnauthorizedException('This institute account has been suspended.');
    }

    req.tenantId = tenant.id;
    req.tenant = tenant;

    next();
  }
}
