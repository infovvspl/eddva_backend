import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolCreatorStudioService } from './school-creator-studio.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/creator-studio')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolCreatorStudioController {
  constructor(private readonly svc: SchoolCreatorStudioService) {}

  @Get('presentations')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  listPresentations(@SchoolUser() user: any, @Query() query: any) { return this.svc.listPresentations(user, query); }

  @Post('presentations')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  createPresentation(@SchoolUser() user: any, @Body() body: any) { return this.svc.createPresentation(user, body); }

  @Get('presentations/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  findOnePresentation(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.findOnePresentation(user, id); }

  @Put('presentations/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  updatePresentation(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.updatePresentation(user, id, body); }

  @Delete('presentations/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  removePresentation(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.removePresentation(user, id); }

  @Get('mind-maps')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  listMindMaps(@SchoolUser() user: any, @Query() query: any) { return this.svc.listMindMaps(user, query); }

  @Post('mind-maps')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  createMindMap(@SchoolUser() user: any, @Body() body: any) { return this.svc.createMindMap(user, body); }

  @Get('mind-maps/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  findOneMindMap(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.findOneMindMap(user, id); }

  @Put('mind-maps/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  updateMindMap(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.updateMindMap(user, id, body); }

  @Delete('mind-maps/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  removeMindMap(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.removeMindMap(user, id); }
}
