import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

const uploadStorage = diskStorage({
  destination: './uploads',
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${uuidv4()}${extname(file.originalname)}`);
  },
});

@Controller('school/assessments')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAssessmentController {
  constructor(private readonly svc: SchoolAssessmentService) {}

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Get('mock-tests') legacyMockTests(@SchoolUser() user: any, @Query() query: any) { return this.svc.legacyMockTests(user, query); }
  @Get('sessions') listSessions(@SchoolUser() user: any) { return this.svc.listSessions(user); }
  @Post('ai-generate') aiGenerate(@SchoolUser() user: any, @Body() body: any) { return this.svc.aiGenerateDraft(user, body); }
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage }))
  create(@SchoolUser() user: any, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.create(user, body, file);
  }
  @Get(':id/my-submission') mySubmission(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.mySubmission(user, id);
  }
  @Post(':id/submit')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage }))
  submit(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.submitAssessment(user, id, body, file);
  }
  @Get(':id/submissions') listSubmissions(@Param('id') id: string) {
    return this.svc.listSubmissions(id);
  }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
  @Get(':id/results') listResults(@Param('id') id: string) { return this.svc.listResults(id); }
  @Post('results') saveResult(@Body() body: any) { return this.svc.saveResult(body); }
}
