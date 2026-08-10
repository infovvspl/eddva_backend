import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SchoolSyllabusService } from './school-syllabus.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/syllabus')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolSyllabusController {
  constructor(private readonly svc: SchoolSyllabusService) {}

  @Post('plans')
  createSyllabusPlan(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.createSyllabusPlan(user, body);
  }

  @Get('tracker')
  getSyllabusTracker(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getSyllabusTracker(user, query);
  }

  @Get('analytics')
  getSyllabusAnalytics(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getSyllabusAnalytics(user, query);
  }

  @Get('teaching-plan')
  getTeacherTeachingPlan(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getTeacherTeachingPlan(user, query);
  }

  @Post('lessons')
  createLessonPlan(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.createLessonPlan(user, body);
  }

  @Post('lessons/ai-template')
  generateAiLessonTemplate(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.generateAiLessonTemplate(user, body);
  }

  @Post('lessons/:id/complete')
  completeLessonPlan(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.completeLessonPlan(user, id, body);
  }

  @Get('templates')
  getLessonTemplates(@SchoolUser() user: any) {
    return this.svc.getLessonTemplates(user);
  }

  @Post('templates')
  createLessonTemplate(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.createLessonTemplate(user, body);
  }

  @Get('student-progress')
  getStudentSyllabusProgress(@SchoolUser() user: any, @Query('studentId') studentId: string) {
    return this.svc.getStudentSyllabusProgress(user, studentId || user.id);
  }

  @Get('parent-progress')
  getParentChildSyllabusProgress(@SchoolUser() user: any, @Query('childId') childId: string) {
    return this.svc.getParentChildSyllabusProgress(user, childId);
  }
}

@Controller('syllabus')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolSyllabusDirectController {
  constructor(private readonly svc: SchoolSyllabusService) {}

  @Post('plans')
  createSyllabusPlan(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.createSyllabusPlan(user, body);
  }

  @Get('tracker')
  getSyllabusTracker(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getSyllabusTracker(user, query);
  }

  @Get('analytics')
  getSyllabusAnalytics(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getSyllabusAnalytics(user, query);
  }

  @Get('teaching-plan')
  getTeacherTeachingPlan(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getTeacherTeachingPlan(user, query);
  }

  @Post('lessons')
  createLessonPlan(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.createLessonPlan(user, body);
  }

  @Post('lessons/ai-template')
  generateAiLessonTemplate(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.generateAiLessonTemplate(user, body);
  }

  @Post('lessons/:id/complete')
  completeLessonPlan(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.completeLessonPlan(user, id, body);
  }

  @Get('templates')
  getLessonTemplates(@SchoolUser() user: any) {
    return this.svc.getLessonTemplates(user);
  }

  @Post('templates')
  createLessonTemplate(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.createLessonTemplate(user, body);
  }

  @Get('student-progress')
  getStudentSyllabusProgress(@SchoolUser() user: any, @Query('studentId') studentId: string) {
    return this.svc.getStudentSyllabusProgress(user, studentId || user.id);
  }

  @Get('parent-progress')
  getParentChildSyllabusProgress(@SchoolUser() user: any, @Query('childId') childId: string) {
    return this.svc.getParentChildSyllabusProgress(user, childId);
  }
}
