import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
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
  presignRecording(@SchoolUser() user: any, @Body() body: any, @Req() req: any) { return this.svc.presignUpload(user, body, req); }

  @Post('recordings')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  createRecording(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Post('recordings/:id/retranscribe')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  retranscribe(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.retranscribe(user, id); }

  @Post('recordings/:id/regenerate-notes')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  regenerateNotes(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.regenerateNotes(user, id); }

  @Post('recordings/:id/regenerate-notes-images')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  regenerateNotesImages(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.regenerateNotesImages(user, id); }

  @Get('recordings/:id/notes-images-data')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  getNotesImagesData(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.getNotesImagesAsDataUrls(user, id); }

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

  @Post('recordings/:id/thumbnail')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  updateThumbnail(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateThumbnail(user, id, body);
  }

  @Post('recordings/:id/regenerate-thumbnail')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  regenerateThumbnail(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.regenerateThumbnail(user, id);
  }

  @Get('student-notes')
  @SchoolRoles('STUDENT')
  getStudentNotes(@SchoolUser() user: any, @Query() query: { lectureId?: string; recordingId?: string }) {
    return this.svc.getStudentNotes(user, query);
  }

  @Post('student-notes')
  @SchoolRoles('STUDENT')
  saveStudentNotes(@SchoolUser() user: any, @Body() body: { lectureId?: string; recordingId?: string; notes: string }) {
    return this.svc.saveStudentNotes(user, body);
  }
}
