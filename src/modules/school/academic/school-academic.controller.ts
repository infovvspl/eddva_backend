import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolAcademicService } from './school-academic.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { Audit } from '../../audit-log/audit.decorator';

@Controller('school/academic')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAcademicController {
  constructor(private readonly svc: SchoolAcademicService) {}

  @Get('classes') listClasses(@SchoolUser() user: any, @Query() query: any) { return this.svc.listClasses(user, query); }

  @Post('classes')
  @Audit({ module: 'Academic', action: 'Class Create', description: 'Created academic class {body.name}' })
  createClass(@SchoolUser() user: any, @Body() body: any) { return this.svc.createClass(user, body); }

  @Put('classes/:id')
  @Audit({ module: 'Academic', action: 'Class Edit', description: 'Updated academic class ID {params.id}' })
  updateClass(@Param('id') id: string, @Body() body: any) { return this.svc.updateClass(id, body); }

  @Delete('classes/:id')
  @Audit({ module: 'Academic', action: 'Class Delete', description: 'Deleted academic class ID {params.id}' })
  deleteClass(@Param('id') id: string) { return this.svc.deleteClass(id); }

  @Get('sections/:sectionId/teaching-map')
  getSectionTeachingMap(@Param('sectionId') sectionId: string) {
    return this.svc.getSectionTeachingMap(sectionId);
  }

  @Get('sections') listSections(@SchoolUser() user: any, @Query() query: any) { return this.svc.listSections(user, query); }
  @Post('sections') createSection(@SchoolUser() user: any, @Body() body: any) { return this.svc.createSection(user, body); }
  @Put('sections/:id') updateSection(@Param('id') id: string, @Body() body: any) { return this.svc.updateSection(id, body); }
  @Delete('sections/:id') deleteSection(@Param('id') id: string) { return this.svc.deleteSection(id); }

  @Get('periods') listPeriods(@SchoolUser() user: any, @Query() query: any) { return this.svc.listPeriods(user, query); }
  @Post('periods') createPeriod(@SchoolUser() user: any, @Body() body: any) { return this.svc.createPeriod(user, body); }
  @Put('periods/:id') updatePeriod(@Param('id') id: string, @Body() body: any) { return this.svc.updatePeriod(id, body); }
  @Delete('periods/:id') deletePeriod(@Param('id') id: string) { return this.svc.deletePeriod(id); }
}
