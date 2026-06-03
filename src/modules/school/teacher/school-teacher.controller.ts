import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolTeacherService } from './school-teacher.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/teachers')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolTeacherController {
  constructor(private readonly svc: SchoolTeacherService) {}

  @Post() create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }
  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Put(':id') update(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.update(user, id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
