import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolDoubtService } from './school-doubt.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';

@Controller('school/doubts')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolFeature('ai', 'ai_doubt_solver')
export class SchoolDoubtController {
  constructor(private readonly svc: SchoolDoubtService) {}

  @Get('context')
  @SchoolRoles('STUDENT')
  getContext(@SchoolUser() user: any) {
    return this.svc.getContext(user);
  }

  @Get()
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  list(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.list(user, query);
  }

  @Post()
  @SchoolRoles('STUDENT')
  create(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.create(user, body);
  }

  @Post('upload-url')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN')
  presignUpload(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.presignImageUpload(user, body);
  }

  @Get(':id')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  findOne(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.findOne(user, id);
  }

  @Post(':id/escalate')
  @SchoolRoles('STUDENT')
  escalate(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.escalate(user, id);
  }

  @Patch(':id/helpful')
  @SchoolRoles('STUDENT')
  markHelpful(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Body() body: { isHelpful?: boolean },
  ) {
    return this.svc.markHelpful(user, id, body?.isHelpful !== false);
  }

  @Post(':id/ai-suggest')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN')
  aiSuggest(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.suggestTeacherAnswer(user, id);
  }

  @Post(':id/respond')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN')
  respond(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.respond(user, id, body);
  }
}
