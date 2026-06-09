import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolClassService } from './school-class.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/classes')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolClassController {
  constructor(private readonly svc: SchoolClassService) {}

  @Get('recordings')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  listRecordings(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }

  @Post('recordings/upload-url')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  presignRecording(@SchoolUser() user: any, @Body() body: any) { return this.svc.presignUpload(user, body); }

  @Post('recordings')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  createRecording(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Post('recordings/:id/retranscribe')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  retranscribe(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.retranscribe(user, id); }

  @Post('recordings/:id/regenerate-notes')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  regenerateNotes(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.regenerateNotes(user, id); }

  @Post('recordings/:id/generate-quiz')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  generateQuiz(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.generateQuiz(user, id); }

  @Delete('recordings/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  removeRecording(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.remove(user, id); }
}
