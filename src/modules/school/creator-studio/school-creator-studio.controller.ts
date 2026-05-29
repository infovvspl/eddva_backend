import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolCreatorStudioService } from './school-creator-studio.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/creator-studio')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolCreatorStudioController {
  constructor(private readonly svc: SchoolCreatorStudioService) {}

  @Get('presentations') listPresentations(@SchoolUser() user: any, @Query() query: any) { return this.svc.listPresentations(user, query); }
  @Post('presentations') createPresentation(@SchoolUser() user: any, @Body() body: any) { return this.svc.createPresentation(user, body); }
  @Get('presentations/:id') findOnePresentation(@Param('id') id: string) { return this.svc.findOnePresentation(id); }
  @Put('presentations/:id') updatePresentation(@Param('id') id: string, @Body() body: any) { return this.svc.updatePresentation(id, body); }
  @Delete('presentations/:id') removePresentation(@Param('id') id: string) { return this.svc.removePresentation(id); }

  @Get('mind-maps') listMindMaps(@SchoolUser() user: any, @Query() query: any) { return this.svc.listMindMaps(user, query); }
  @Post('mind-maps') createMindMap(@SchoolUser() user: any, @Body() body: any) { return this.svc.createMindMap(user, body); }
  @Get('mind-maps/:id') findOneMindMap(@Param('id') id: string) { return this.svc.findOneMindMap(id); }
  @Put('mind-maps/:id') updateMindMap(@Param('id') id: string, @Body() body: any) { return this.svc.updateMindMap(id, body); }
  @Delete('mind-maps/:id') removeMindMap(@Param('id') id: string) { return this.svc.removeMindMap(id); }
}
