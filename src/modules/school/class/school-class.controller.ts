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

  @Get('recordings/:id/play-url')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  getRecordingPlayUrl(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.getPlayUrl(user, id); }

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

  @Get('recordings/:id/quiz-analytics')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  getQuizAnalytics(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getQuizAnalytics(user, id);
  }

  @Get('recordings/:id/progress')
  @SchoolRoles('STUDENT')
  getRecordingProgress(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getProgress(user, id);
  }

  @Post('recordings/:id/progress')
  @SchoolRoles('STUDENT')
  upsertRecordingProgress(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.upsertProgress(user, id, body);
  }

  @Post('recordings/:id/quiz-response')
  @SchoolRoles('STUDENT')
  submitQuizResponse(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.submitQuizResponse(user, id, body);
  }

  @Delete('recordings/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  removeRecording(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.remove(user, id); }
}
