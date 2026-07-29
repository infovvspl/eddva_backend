import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { Audit } from '../../audit-log/audit.decorator';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';

const uploadsDir = join(__dirname, '../../../../uploads');
mkdirSync(uploadsDir, { recursive: true });

const uploadStorage = diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${uuidv4()}${extname(file.originalname)}`);
  },
});

@Controller('school/assessments')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolFeature('module', 'assessments')
export class SchoolAssessmentController {
  constructor(private readonly svc: SchoolAssessmentService) {}

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Get('mock-tests') legacyMockTests(@SchoolUser() user: any, @Query() query: any) { return this.svc.legacyMockTests(user, query); }
  @Get('sessions') listSessions(@SchoolUser() user: any, @Query() query: any) { return this.svc.listSessions(user, query); }
  @Post('ai-generate')
  @SchoolFeature('ai', 'ai_content_generator_assessments')
  aiGenerate(@SchoolUser() user: any, @Body() body: any) { return this.svc.aiGenerateDraft(user, body); }

  @Post('translate')
  @SchoolFeature('ai', 'ai_translation')
  translate(@SchoolUser() user: any, @Body() body: { text: string; language: string }) { return this.svc.translateText(user, body.text, body.language); }
  @Post()
  @Audit({ module: 'Assessment', action: 'Assessment Create', description: 'Created assessment {body.title}' })
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage }))
  create(@SchoolUser() user: any, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.create(user, body, file);
  }
  @Get(':id/my-submission') mySubmission(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.mySubmission(user, id);
  }
  @Post(':id/start')
  startAttempt(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.startAttempt(user, id);
  }
  @Post(':id/answer')
  saveAnswer(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.saveAnswer(user, id, body);
  }
  @Post(':id/submit')
  @Audit({ module: 'Assessment', action: 'Assessment Submit', description: 'Submitted assessment ID {params.id}' })
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage }))
  submit(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any, @Req() req: any, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.submitAssessment(user, id, body, file, req);
  }
  @Get(':id/submissions')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  listSubmissions(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.listSubmissions(user, id);
  }
  @Get(':id') findOne(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.findOne(user, id); }

  @Get(':id/submissions/:studentId/review')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  getSubmissionForReview(@SchoolUser() user: any, @Param('id') id: string, @Param('studentId') studentId: string) {
    return this.svc.getSubmissionForReview(user, id, studentId);
  }

  @Put(':id/submissions/:studentId/review')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @Audit({ module: 'Assessment', action: 'AI Grading Review', description: 'Reviewed AI-graded submission for student {params.studentId}' })
  reviewSubjectiveGrading(@SchoolUser() user: any, @Param('id') id: string, @Param('studentId') studentId: string, @Body() body: any) {
    return this.svc.reviewSubjectiveGrading(user, id, studentId, body);
  }

  @Post(':id/submissions/:studentId/publish')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @Audit({ module: 'Assessment', action: 'Result Publish', description: 'Published result for student {params.studentId}' })
  publishGradedResult(@SchoolUser() user: any, @Param('id') id: string, @Param('studentId') studentId: string) {
    return this.svc.publishGradedResult(user, id, studentId);
  }

  @Put(':id')
  @Audit({ module: 'Assessment', action: 'Assessment Edit', description: 'Updated assessment ID {params.id}' })
  update(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.update(user, id, body); }

  @Delete(':id')
  @Audit({ module: 'Assessment', action: 'Assessment Delete', description: 'Deleted assessment ID {params.id}' })
  remove(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.remove(user, id); }
  @Get(':id/results') listResults(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.listResults(user, id); }

  @Post('results')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  saveResult(@SchoolUser() user: any, @Body() body: any) { return this.svc.saveResult(user, body); }
}
