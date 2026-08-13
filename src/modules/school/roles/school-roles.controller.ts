import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SchoolRolesService } from './school-roles.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/roles')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolRolesController {
  constructor(private readonly rolesService: SchoolRolesService) {}

  @Post()
  @SchoolRoles('INSTITUTE_ADMIN')
  create(@SchoolUser() user: any, @Body() dto: { name: string; description?: string; permissions?: string[] }) {
    return this.rolesService.create(user, dto);
  }

  @Get()
  @SchoolRoles('INSTITUTE_ADMIN')
  findAll(@SchoolUser() user: any) {
    return this.rolesService.findAll(user);
  }

  @Get(':id')
  @SchoolRoles('INSTITUTE_ADMIN')
  findOne(@SchoolUser() user: any, @Param('id') id: string) {
    return this.rolesService.findOne(user, id);
  }

  @Patch(':id')
  @SchoolRoles('INSTITUTE_ADMIN')
  update(@SchoolUser() user: any, @Param('id') id: string, @Body() dto: { name?: string; description?: string; permissions?: string[] }) {
    return this.rolesService.update(user, id, dto);
  }

  @Delete(':id')
  @SchoolRoles('INSTITUTE_ADMIN')
  remove(@SchoolUser() user: any, @Param('id') id: string) {
    return this.rolesService.remove(user, id);
  }
}
