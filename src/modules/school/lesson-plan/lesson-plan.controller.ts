import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';
import { LessonPlanService } from './lesson-plan.service';
import { UPLOAD_MAX_BYTES } from './lesson-plan.constants';
import {
  CreateManualLessonPlanDto, GenerateLessonPlansDto, ImportLessonPlanDto, ListLessonPlansQueryDto, RecordProgressDto,
  RegenerateSectionDto, SaveLessonPlanNotesDto, SendBackLessonPlanDto, SubmitLessonPlanDto, UpdateLessonPlanDto,
} from './dto/lesson-plan.dto';

/**
 * Chapter lesson plans. Teachers create and submit (their own, for subjects
 * they teach); institute admins approve or send back. Students and parents
 * have no access.
 */
@Controller('school/lesson-plans')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
export class LessonPlanController {
  constructor(private readonly svc: LessonPlanService) {}

  // ── Teacher ──────────────────────────────────────────────────────────────
  @Get('my')
  @SchoolRoles('TEACHER')
  listMine(@SchoolUser() user: any) { return this.svc.listMine(user); }

  @Get('my/chapters')
  @SchoolRoles('TEACHER')
  chapters(@SchoolUser() user: any, @Query('classId', ParseUUIDPipe) classId: string, @Query('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.svc.chaptersFor(user, classId, subjectId);
  }

  @Post('generate')
  @SchoolRoles('TEACHER')
  generate(@SchoolUser() user: any, @Body() dto: GenerateLessonPlansDto) { return this.svc.generate(user, dto); }

  @Post()
  @SchoolRoles('TEACHER')
  createManual(@SchoolUser() user: any, @Body() dto: CreateManualLessonPlanDto) { return this.svc.createManual(user, dto); }

  /** Multipart: `file` (PDF, up to 10 MB) plus classId, subjectId, chapterId[, minutesPerPeriod]. */
  @Post('import')
  @SchoolRoles('TEACHER')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } }))
  importUpload(@SchoolUser() user: any, @Body() dto: ImportLessonPlanDto, @UploadedFile() file: Express.Multer.File) {
    return this.svc.importUpload(user, dto, file);
  }

  @Get('my/:id')
  @SchoolRoles('TEACHER')
  getMine(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.getForTeacher(user, id); }

  @Put('my/:id')
  @SchoolRoles('TEACHER')
  update(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLessonPlanDto) {
    return this.svc.update(user, id, dto);
  }

  @Post('my/:id/submit')
  @SchoolRoles('TEACHER')
  submit(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitLessonPlanDto) {
    return this.svc.submit(user, id, dto?.revision);
  }

  @Post('my/:id/regenerate')
  @SchoolRoles('TEACHER')
  regenerate(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RegenerateSectionDto) {
    return this.svc.regenerateSection(user, id, dto);
  }

  @Post('my/:id/retry')
  @SchoolRoles('TEACHER')
  retry(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.retry(user, id); }

  @Post('my/:id/progress')
  @SchoolRoles('TEACHER')
  recordProgress(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordProgressDto) {
    return this.svc.recordProgress(user, id, dto);
  }

  @Put('my/:id/notes')
  @SchoolRoles('TEACHER')
  saveNotes(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveLessonPlanNotesDto) {
    return this.svc.saveNotes(user, id, dto.note);
  }

  @Post('my/:id/new-version')
  @SchoolRoles('TEACHER')
  newVersion(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.newVersion(user, id); }

  @Delete('my/:id')
  @SchoolRoles('TEACHER')
  discard(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.discard(user, id); }

  // ── Admin (Syllabus permission) ──────────────────────────────────────────
  @Get('review')
  @SchoolRoles('INSTITUTE_ADMIN')
  @RequireAdminModule('syllabus_planner')
  adminList(@SchoolUser() user: any, @Query() q: ListLessonPlansQueryDto) { return this.svc.adminList(user, q); }

  @Get('review/:id')
  @SchoolRoles('INSTITUTE_ADMIN')
  @RequireAdminModule('syllabus_planner')
  adminGet(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.adminGet(user, id); }

  @Post('review/:id/approve')
  @SchoolRoles('INSTITUTE_ADMIN')
  @RequireAdminModule('syllabus_planner')
  approve(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.svc.approve(user, id); }

  @Post('review/:id/send-back')
  @SchoolRoles('INSTITUTE_ADMIN')
  @RequireAdminModule('syllabus_planner')
  sendBack(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendBackLessonPlanDto) {
    return this.svc.sendBack(user, id, dto.comment);
  }
}
