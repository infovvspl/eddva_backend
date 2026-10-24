import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolTeacherAttendanceService } from './school-teacher-attendance.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { Audit } from '../../audit-log/audit.decorator';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';

// Manual MVP ahead of the biometric staff-attendance system: admin-only,
// gated by the same 'attendance' admin-permission teachers already use.
@Controller('school/teacher-attendance')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
@SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
@RequireAdminModule('attendance')
export class SchoolTeacherAttendanceController {
  constructor(private readonly svc: SchoolTeacherAttendanceService) {}

  @Get()
  getForDate(@SchoolUser() user: any, @Query('date') date?: string) {
    return this.svc.getForDate(user, date);
  }

  @Post()
  @Audit({ module: 'Academic', action: 'Teacher Attendance Save', description: 'Marked a teacher\'s attendance' })
  mark(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.mark(user, body);
  }

  @Post('bulk')
  @Audit({ module: 'Academic', action: 'Teacher Attendance Bulk Save', description: 'Marked attendance for multiple teachers' })
  markBulk(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.markBulk(user, body);
  }

  @Get('history')
  getHistory(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getHistory(user, query);
  }

  @Get('month')
  getMonthGrid(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getMonthGrid(user, query);
  }

  @Get('year-summary')
  getYearSummary(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getYearSummary(user, query);
  }

  // ── Teacher self check-in (geofence) ──────────────────────────────────────
  // Method-level @SchoolRoles overrides the class-level admin-only roles
  // (SchoolRolesGuard uses Reflector.getAllAndOverride); AdminModuleGuard is a
  // no-op for non-INSTITUTE_ADMIN roles, so TEACHER reaches these unblocked.

  @Post('check-in')
  @SchoolRoles('TEACHER')
  @Audit({ module: 'Academic', action: 'Teacher Self Check-In', description: 'Teacher checked themselves in via geofence' })
  checkIn(@SchoolUser() user: any, @Body() body: { latitude: number; longitude: number }) {
    return this.svc.checkIn(user, body);
  }

  @Post('check-out')
  @SchoolRoles('TEACHER')
  @Audit({ module: 'Academic', action: 'Teacher Self Check-Out', description: 'Teacher checked themselves out' })
  checkOut(@SchoolUser() user: any) {
    return this.svc.checkOut(user);
  }

  @Get('me')
  @SchoolRoles('TEACHER')
  getMyHistory(@SchoolUser() user: any, @Query() query: { month?: string }) {
    return this.svc.getMyHistory(user, query);
  }

  // ── Admin: campus geofence settings ────────────────────────────────────────

  @Get('settings')
  getSettings(@SchoolUser() user: any) {
    return this.svc.getAttendanceSettings(user);
  }

  @Post('settings')
  @Audit({ module: 'Academic', action: 'Attendance Settings Save', description: 'Updated campus geofence/work-start attendance settings' })
  updateSettings(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.updateAttendanceSettings(user, body);
  }
}
