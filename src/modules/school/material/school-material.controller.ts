import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolMaterialService } from './school-material.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/materials')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolMaterialController {
  constructor(private readonly svc: SchoolMaterialService) {}

  @Get()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }

  @Post()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Get(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  findOne(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.findOne(user, id); }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  update(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.update(user, id, body); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  remove(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.remove(user, id); }
}
