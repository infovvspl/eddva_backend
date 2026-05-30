import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/assessments')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAssessmentController {
  constructor(private readonly svc: SchoolAssessmentService) {}

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Post() create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
  @Get(':id/results') listResults(@Param('id') id: string) { return this.svc.listResults(id); }
  @Post('results') saveResult(@Body() body: any) { return this.svc.saveResult(body); }
}
