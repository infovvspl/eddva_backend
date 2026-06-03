import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolSubjectService } from './school-subject.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/subjects')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolSubjectController {
  constructor(private readonly svc: SchoolSubjectService) {}

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Post() create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
  @Get('class/:classId') listClassSubjects(@Param('classId') id: string) { return this.svc.listClassSubjects(id); }
  @Post('class') addClassSubject(@Body() body: any) { return this.svc.addClassSubject(body); }
  @Get('teacher/:teacherId') listTeacherSubjects(@Param('teacherId') id: string) { return this.svc.listTeacherSubjects(id); }
  @Post('teacher') assignTeacherSubject(@Body() body: any) { return this.svc.assignTeacherSubject(body); }
}

@Controller('school/academic/subjects')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAcademicSubjectController {
  constructor(private readonly svc: SchoolSubjectService) {}

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Post() create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

