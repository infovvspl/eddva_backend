import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolTopicService } from './school-topic.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/topics')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolTopicController {
  constructor(private readonly svc: SchoolTopicService) {}

  @Get()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  listTopics(@Query() query: any) { return this.svc.listTopics(query); }

  @Post()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  createTopic(@SchoolUser() user: any, @Body() body: any) { return this.svc.createTopic(user, body); }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  updateTopic(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.updateTopic(user, id, body); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  deleteTopic(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.deleteTopic(user, id); }

  @Get('chapters')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  listChapters(@Query() query: any) { return this.svc.listChapters(query); }

  @Post('bulk-import')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  bulkImport(@SchoolUser() user: any, @Body() body: any) { return this.svc.bulkImport(user, body); }

  @Post('chapters')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  createChapter(@SchoolUser() user: any, @Body() body: any) { return this.svc.createChapter(user, body); }

  @Put('chapters/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  updateChapter(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.updateChapter(user, id, body); }

  @Delete('chapters/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  deleteChapter(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.deleteChapter(user, id); }
}
