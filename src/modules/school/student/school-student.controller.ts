import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolStudentService } from './school-student.service';
import { SchoolStudentExitService } from './school-student-exit.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { Audit } from '../../audit-log/audit.decorator';

@Controller('school/students')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolStudentController {
  constructor(
    private readonly svc: SchoolStudentService,
    private readonly exitSvc: SchoolStudentExitService,
  ) { }

  @Post('bulk-import')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  bulkImport(@SchoolUser() user: any, @Body() body: any) { return this.svc.bulkImport(user, body); }

  @Post()
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @Audit({ module: 'Users', action: 'Student Create', description: 'Created student {body.name}' })
  create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Get('profile/me') getMyProfile(@SchoolUser() user: any) { return this.svc.findOne(user, user.id); }
  @Get('stats') stats(@SchoolUser() user: any, @Query() query: any) { return this.svc.getStats(user, query); }
  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Get('courses/my') myCourses(@SchoolUser() user: any) { return this.svc.getMyCourses(user); }
  @Get('dashboard') dashboard(@SchoolUser() user: any) { return this.svc.getDashboard(user); }
  @Get('courses/:classId') courseCurriculum(@SchoolUser() user: any, @Param('classId') classId: string) {
    return this.svc.getCourseDetail(user, classId);
  }

  @Get(':id/exit-record')
  getExitRecord(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.exitSvc.getExitRecord(user, id);
  }

  @Post(':id/exit-record')
  createOrUpdateExitRecord(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.exitSvc.createOrUpdateExitRecord(user, id, body);
  }

  @Get(':id') findOne(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.findOne(user, id); }

  @Put(':id')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @Audit({ module: 'Users', action: 'Student Edit', description: 'Updated student ID {params.id}' })
  update(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) { return this.svc.update(user, id, body); }

  @Delete(':id')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @Audit({ module: 'Users', action: 'Student Delete', description: 'Deleted student ID {params.id}' })
  remove(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(user, id); }

  @Post(':id/send-credentials')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  sendParentCredentials(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.svc.sendParentCredentials(user, id, body);
  }

  @Post(':id/previous-results')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  addPreviousResult(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.svc.addPreviousResult(user, id, body);
  }

  @Post('device-token')
  registerDeviceToken(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.registerDeviceToken(user, body);
  }
}