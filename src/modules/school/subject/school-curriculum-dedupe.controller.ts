import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolCurriculumDedupeService } from './school-curriculum-dedupe.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { Audit } from '../../audit-log/audit.decorator';

/**
 * Reporting and merging are separate endpoints on purpose: merging moves live
 * curriculum, so the caller reviews the report and names the groups to merge.
 * Admin-only — teachers must not reshape curriculum.
 */
@Controller('school/curriculum')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolCurriculumDedupeController {
  constructor(private readonly svc: SchoolCurriculumDedupeService) {}

  /** Read-only: which subjects are duplicated, and what would move. */
  @Get('duplicates')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  findDuplicates(@SchoolUser() user: any, @Query('instituteId') instituteId?: string) {
    return this.svc.findDuplicates(user, instituteId);
  }

  /** Merge only the groups named in the body. */
  @Post('duplicates/merge')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  @Audit({ module: 'Institute', action: 'Update', description: 'Merged duplicate curriculum subjects' })
  merge(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.mergeGroups(user, body?.groupKeys, body?.instituteId);
  }
}
