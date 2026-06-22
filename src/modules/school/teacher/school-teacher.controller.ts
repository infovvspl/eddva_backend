import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolTeacherService } from './school-teacher.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/teachers')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolTeacherController {
  constructor(private readonly svc: SchoolTeacherService) { }

  @Post('bulk-import') bulkImport(@SchoolUser() user: any, @Body() body: any) { return this.svc.bulkImport(user, body); }
  @Post() create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }
  @Get('stats') stats(@SchoolUser() user: any, @Query() query: any) { return this.svc.getStats(user, query); }
  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }

  // ── Video Performance Analysis (INSTITUTE_ADMIN / SUPER_ADMIN only) ────────
  @Get(':teacherId/recordings/summary')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  recordingsSummary(
    @SchoolUser() user: any,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Query() query: any,
  ) { return this.svc.getTeacherRecordingsSummary(user, teacherId, query); }

  @Get(':teacherId/recordings')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  recordings(
    @SchoolUser() user: any,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Query() query: any,
  ) { return this.svc.getTeacherRecordings(user, teacherId, query); }

  @Post(':teacherId/recordings/:recordingId/analyze')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  analyzeRecording(
    @SchoolUser() user: any,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Param('recordingId', ParseUUIDPipe) recordingId: string,
    @Query() query: any,
  ) { return this.svc.analyzeTeacherRecording(user, teacherId, recordingId, query); }
  // ──────────────────────────────────────────────────────────────────────────

  @Get(':id') findOne(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.findOne(user, id); }
  @Put(':id') update(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) { return this.svc.update(user, id, body); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(id); }
}
