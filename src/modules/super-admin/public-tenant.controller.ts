import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../../common/decorators/auth.decorator';
import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';

@ApiTags('Public Tenant')
@Controller('tenants')
export class PublicTenantController {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  @Get('resolve/:subdomain')
  @Public()
  @ApiOperation({ summary: 'Resolve tenant by subdomain (public)' })
  async resolveBySubdomain(@Param('subdomain') subdomain: string) {
    const tenant = await this.tenantRepo.findOne({
      where: { subdomain },
      select: ['id', 'name', 'subdomain', 'status', 'plan', 'logoUrl', 'brandColor', 'welcomeMessage'],
    });

    if (!tenant) {
      throw new NotFoundException('Institute not found');
    }

    if (tenant.status === TenantStatus.SUSPENDED) {
      return {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        status: tenant.status,
        suspended: true,
      };
    }

    return {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      status: tenant.status,
      plan: tenant.plan,
      logoUrl: tenant.logoUrl,
      brandColor: tenant.brandColor,
      welcomeMessage: tenant.welcomeMessage,
    };
  }
}
