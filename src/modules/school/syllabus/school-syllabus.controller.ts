import { Controller, Get, Post, Put, Patch, Delete, Body, Param, ParseUUIDPipe, Query, UseGuards, GoneException } from '@nestjs/common';
import { SchoolSyllabusService } from './school-syllabus.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';
import {
  CompleteLessonPlanDto,
  CreateLessonPlanDto,
  CreateLessonTemplateDto,
  CreateSyllabusPlanDto,
  UpdateSyllabusPlanDto,
  UpdateSyllabusPlanProgressDto,
} from './dto/school-syllabus.dto';

/**
 * Every route names its roles. SchoolRolesGuard lets any signed-in school user
 * through a route that declares none, so before this a student or parent could
 * create, change and delete syllabus plans, create lesson plans, run the AI
 * brief and publish templates (lesson-plan audit, 22 Oct 2026, finding D1).
 *
 * Who uses what (from the frontend):
 *   admin pages     — plans CRUD, tracker
 *   teacher pages   — plans read, plan progress, teaching plan, lessons, templates
 *   student / parent— their own progress views
 */
const ADMIN = ['INSTITUTE_ADMIN', 'SUPER_ADMIN'];
const STAFF = ['TEACHER', ...ADMIN];

@Controller('school/syllabus')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
@RequireAdminModule('syllabus_planner')
export class SchoolSyllabusController {
  constructor(private readonly svc: SchoolSyllabusService) {}

  @Post('plans')
  @SchoolRoles(...ADMIN)
  createSyllabusPlan(@SchoolUser() user: any, @Body() body: CreateSyllabusPlanDto) {
    return this.svc.createSyllabusPlan(user, body);
  }

  @Get('plans')
  @SchoolRoles(...STAFF)
  getSyllabusPlans(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getSyllabusPlans(user, query);
  }

  @Get('plans/:id')
  @SchoolRoles(...STAFF)
  getSyllabusPlanById(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getSyllabusPlanById(user, id);
  }

  @Put('plans/:id')
  @SchoolRoles(...ADMIN)
  updateSyllabusPlan(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSyllabusPlanDto) {
    return this.svc.updateSyllabusPlan(user, id, body);
  }

  @Patch('plans/:id/progress')
  @SchoolRoles(...STAFF)
  updateSyllabusPlanProgress(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSyllabusPlanProgressDto) {
    return this.svc.updateSyllabusPlanProgress(user, id, body);
  }

  @Delete('plans/:id')
  @SchoolRoles(...ADMIN)
  deleteSyllabusPlan(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteSyllabusPlan(user, id);
  }

  @Get('tracker')
  @SchoolRoles(...ADMIN)
  getSyllabusTracker(@SchoolUser() user: any, @Query() query: any) {
    if (query?.planId) {
      return this.svc.getDetailedPlanTracker(user, query.planId);
    }
    return this.svc.getSyllabusTracker(user, query);
  }

  @Get('tracker-details/:planId')
  @SchoolRoles(...ADMIN)
  getDetailedPlanTracker(@SchoolUser() user: any, @Param('planId', ParseUUIDPipe) planId: string) {
    return this.svc.getDetailedPlanTracker(user, planId);
  }

  @Get('teaching-plan')
  @SchoolRoles('TEACHER')
  getTeacherTeachingPlan(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getTeacherTeachingPlan(user, query);
  }

  /** Just the teacher's annual syllabus plans (with topic progress), for "My Lesson Plan". */
  @Get('teaching-plan/annual-plans')
  @SchoolRoles('TEACHER')
  async getTeacherAnnualPlans(@SchoolUser() user: any) {
    return { success: true, data: await this.svc.getTeacherAnnualPlans(user) };
  }

  @Post('lessons')
  @SchoolRoles('TEACHER')
  createLessonPlan(@SchoolUser() user: any, @Body() body: CreateLessonPlanDto) {
    return this.svc.createLessonPlan(user, body);
  }

  @Get('lessons/:id')
  @SchoolRoles(...STAFF)
  getLessonPlanById(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getLessonPlanById(user, id);
  }

  /**
   * Retired: the per-session AI brief went through the model router (which can
   * fall back to Gemini) and is replaced by chapter lesson plans
   * (school/lesson-plans), which use one configured non-Gemini model. No screen
   * calls this any more; an old client gets a clear 410 instead of AI content.
   */
  @Post('lessons/ai-template')
  @SchoolRoles('TEACHER')
  // No body DTO: a retired route answers 410 whatever it is sent (a DTO would turn bad bodies into 400s).
  generateAiLessonTemplate(@SchoolUser() _user: any) {
    throw new GoneException('AI lesson briefs have been replaced by chapter lesson plans: open My Teaching Plan → Lesson plans.');
  }

  @Post('lessons/:id/complete')
  @SchoolRoles('TEACHER')
  completeLessonPlan(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: CompleteLessonPlanDto) {
    return this.svc.completeLessonPlan(user, id, body);
  }

  @Get('templates')
  @SchoolRoles(...STAFF)
  getLessonTemplates(@SchoolUser() user: any) {
    return this.svc.getLessonTemplates(user);
  }

  @Post('templates')
  @SchoolRoles(...STAFF)
  createLessonTemplate(@SchoolUser() user: any, @Body() body: CreateLessonTemplateDto) {
    return this.svc.createLessonTemplate(user, body);
  }

  /** A student sees their own progress; staff may look up a student of their school. */
  @Get('student-progress')
  @SchoolRoles('STUDENT', ...STAFF)
  getStudentSyllabusProgress(@SchoolUser() user: any, @Query('studentId') studentId?: string) {
    return this.svc.getStudentSyllabusProgress(user, studentId);
  }

  /** A parent sees one of their own children (the first, unless childId names another). */
  @Get('parent-progress')
  @SchoolRoles('PARENT')
  getParentChildSyllabusProgress(@SchoolUser() user: any, @Query('childId') childId?: string) {
    return this.svc.getParentChildSyllabusProgress(user, childId);
  }
}
