import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolSubjectService } from './school-subject.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/subjects')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolSubjectController {
  constructor(private readonly svc: SchoolSubjectService) {}

  @Get()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }

  @Post()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Get('class/:classId')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  listClassSubjects(@Param('classId') id: string) { return this.svc.listClassSubjects(id); }

  @Post('class')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  addClassSubject(@Body() body: any) { return this.svc.addClassSubject(body); }

  @Get('teacher/:teacherId')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  listTeacherSubjects(@Param('teacherId') id: string) { return this.svc.listTeacherSubjects(id); }

  @Post('teacher')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  assignTeacherSubject(@Body() body: any) { return this.svc.assignTeacherSubject(body); }
}

@Controller('school/academic/subjects')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAcademicSubjectController {
  constructor(private readonly svc: SchoolSubjectService) {}

  @Get()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }

  @Post()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}

