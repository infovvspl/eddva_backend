import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolAcademicService } from './school-academic.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/academic')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAcademicController {
  constructor(private readonly svc: SchoolAcademicService) {}

  @Get('classes') listClasses(@SchoolUser() user: any, @Query() query: any) { return this.svc.listClasses(user, query); }
  @Post('classes') createClass(@SchoolUser() user: any, @Body() body: any) { return this.svc.createClass(user, body); }
  @Put('classes/:id') updateClass(@Param('id') id: string, @Body() body: any) { return this.svc.updateClass(id, body); }
  @Delete('classes/:id') deleteClass(@Param('id') id: string) { return this.svc.deleteClass(id); }

  @Get('sections') listSections(@SchoolUser() user: any, @Query() query: any) { return this.svc.listSections(user, query); }
  @Post('sections') createSection(@Body() body: any) { return this.svc.createSection(body); }
  @Put('sections/:id') updateSection(@Param('id') id: string, @Body() body: any) { return this.svc.updateSection(id, body); }
  @Delete('sections/:id') deleteSection(@Param('id') id: string) { return this.svc.deleteSection(id); }
}
