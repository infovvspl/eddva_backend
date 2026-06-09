import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolStudentService } from './school-student.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/students')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolStudentController {
  constructor(private readonly svc: SchoolStudentService) { }

  @Post('bulk-import') bulkImport(@SchoolUser() user: any, @Body() body: any) { return this.svc.bulkImport(user, body); }
  @Post() create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }
  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Get('courses/my') myCourses(@SchoolUser() user: any) { return this.svc.getMyCourses(user); }
  @Get('courses/:classId') courseCurriculum(@SchoolUser() user: any, @Param('classId') classId: string) {
    return this.svc.getCourseDetail(user, classId);
  }
  // Must be declared before ':id' so it isn't swallowed by the dynamic param route.
  @Get('dashboard') dashboard(@SchoolUser() user: any) { return this.svc.getDashboard(user); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Post(':id/send-credentials')
  sendParentCredentials(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.sendParentCredentials(user, id, body);
  }
}
