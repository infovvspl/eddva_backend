import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export const RequireFeature = (feature: string) => SetMetadata('requiredFeature', feature);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectDataSource('coaching') private dataSource: DataSource
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.get<string>('requiredFeature', context.getHandler());
    if (!requiredFeature) return true;
    
    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId || request.tenantId;
    if (!tenantId) return false;
    
    const tenantRows = await this.dataSource.query(
      `SELECT metadata FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (!tenantRows || tenantRows.length === 0) return false;
    
    const modulesPermissions = tenantRows[0].metadata?.modulesPermissions;
    
    // Fail open if not configured
    if (!modulesPermissions) return true;
    return modulesPermissions[requiredFeature] !== false;
  }
}
