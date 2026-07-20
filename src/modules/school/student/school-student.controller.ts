import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolStudentService } from './school-student.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { Audit } from '../../audit-log/audit.decorator';

@Controller('school/students')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolStudentController {
  constructor(private readonly svc: SchoolStudentService) { }

  @Post('bulk-import') bulkImport(@SchoolUser() user: any, @Body() body: any) { return this.svc.bulkImport(user, body); }

  @Post()
  @Audit({ module: 'Users', action: 'Student Create', description: 'Created student {body.name}' })
  create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Get('profile/me') getMyProfile(@SchoolUser() user: any) { return this.svc.findOne(user.id); }
  @Get('stats') stats(@SchoolUser() user: any, @Query() query: any) { return this.svc.getStats(user, query); }
  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Get('courses/my') myCourses(@SchoolUser() user: any) { return this.svc.getMyCourses(user); }
  @Get('dashboard') dashboard(@SchoolUser() user: any) { return this.svc.getDashboard(user); }
  @Get('courses/:classId') courseCurriculum(@SchoolUser() user: any, @Param('classId') classId: string) {
    return this.svc.getCourseDetail(user, classId);
  }
  @Get(':id') findOne(@Param('id', ParseUUIDPipe) id: string) { return this.svc.findOne(id); }

  @Put(':id')
  @Audit({ module: 'Users', action: 'Student Edit', description: 'Updated student ID {params.id}' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: any) { return this.svc.update(id, body); }

  @Delete(':id')
  @Audit({ module: 'Users', action: 'Student Delete', description: 'Deleted student ID {params.id}' })
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(id); }

  @Post(':id/send-credentials')
  sendParentCredentials(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.svc.sendParentCredentials(user, id, body);
  }

  @Post(':id/previous-results')
  addPreviousResult(@Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.svc.addPreviousResult(id, body);
  }

  @Post('device-token')
  registerDeviceToken(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.registerDeviceToken(user, body);
  }
}