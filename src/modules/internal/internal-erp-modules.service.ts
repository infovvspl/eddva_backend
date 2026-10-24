import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Read-only lookup for the ERP backend: which modules (by path, e.g.
 * '/canteen') a given school institute currently has enabled. Mirrors
 * SchoolErpModulesService.getInstituteModules() (super-admin module) but
 * lives here, unexported, so InternalModule doesn't need to import
 * SuperAdminModule — which already imports InternalModule, and importing
 * back would be circular.
 */
@Injectable()
export class InternalErpModulesService {
  constructor(@InjectDataSource('school') private readonly schoolDs: DataSource) {}

  async getEnabledModulePaths(instituteId: string): Promise<string[]> {
    const rows: Array<{ path: string | null }> = await this.schoolDs.query(
      `SELECT m.path
       FROM school_erp_modules m
       INNER JOIN school_erp_module_assignments a ON m.id = a.module_id
       WHERE a.institute_id = $1
         AND a.is_active = true
         AND m.is_active = true`,
      [instituteId],
    );
    return rows.map((r) => r.path).filter((p): p is string => !!p);
  }
}
