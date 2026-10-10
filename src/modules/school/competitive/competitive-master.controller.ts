import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { CompetitiveMasterService } from './competitive-master.service';
import {
  CreateCompetitiveQuestionDto,
  CreateMasterChapterDto,
  CreateMasterExamDto,
  CreateMasterSubjectDto,
  CreateMasterTopicDto,
  IngestFromPdfDto,
  ListQuestionsQueryDto,
  UpdateMasterExamDto,
  UpdateMasterSubjectDto,
  VerifyQuestionDto,
} from './dto/competitive-master.dto';

/**
 * Super-Admin-only: manage the global competitive taxonomy and question
 * bank. No `CompetitiveFeatureGuard` here — Super Admin curates this bank
 * regardless of which institutes currently have the flag enabled.
 */
@Controller('super-admin/school/competitive')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@SchoolRoles('SUPER_ADMIN')
export class CompetitiveMasterController {
  constructor(private readonly svc: CompetitiveMasterService) {}

  @Get('exams') listExams() {
    return this.svc.listExams();
  }
  @Post('exams') createExam(@Body() dto: CreateMasterExamDto) {
    return this.svc.createExam(dto);
  }
  @Put('exams/:id') updateExam(@Param('id') id: string, @Body() dto: UpdateMasterExamDto) {
    return this.svc.updateExam(id, dto);
  }
  @Delete('exams/:id') deleteExam(@Param('id') id: string) {
    return this.svc.deleteExam(id);
  }

  @Get('subjects') listSubjects(@Query('examId') examId?: string) {
    return this.svc.listSubjects(examId);
  }
  @Post('subjects') createSubject(@Body() dto: CreateMasterSubjectDto) {
    return this.svc.createSubject(dto);
  }
  @Put('subjects/:id') updateSubject(@Param('id') id: string, @Body() dto: UpdateMasterSubjectDto) {
    return this.svc.updateSubject(id, dto);
  }
  @Delete('subjects/:id') deleteSubject(@Param('id') id: string) {
    return this.svc.deleteSubject(id);
  }

  @Get('chapters') listChapters(@Query('masterSubjectId') masterSubjectId: string) {
    return this.svc.listChapters(masterSubjectId);
  }
  @Post('chapters') createChapter(@Body() dto: CreateMasterChapterDto) {
    return this.svc.createChapter(dto);
  }
  @Delete('chapters/:id') deleteChapter(@Param('id') id: string) {
    return this.svc.deleteChapter(id);
  }

  @Get('topics') listTopics(@Query('masterChapterId') masterChapterId: string) {
    return this.svc.listTopics(masterChapterId);
  }
  @Post('topics') createTopic(@Body() dto: CreateMasterTopicDto) {
    return this.svc.createTopic(dto);
  }
  @Delete('topics/:id') deleteTopic(@Param('id') id: string) {
    return this.svc.deleteTopic(id);
  }

  /**
   * Upload a PYQ / question-bank PDF (and optionally a separate answer-key
   * PDF) straight from the browser and run it through the vision-LLM
   * extraction pipeline. Matches the 250MB ceiling the textbook pipeline
   * already uses for the same reason — several real question-bank
   * compilations run well past 100MB.
   */
  @Post('ingest')
  @UseInterceptors(FileFieldsInterceptor(
    [{ name: 'file', maxCount: 1 }, { name: 'answerKeyFile', maxCount: 1 }],
    { storage: memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } },
  ))
  ingestFromPdf(
    @SchoolUser() user: any,
    @Body() dto: Omit<IngestFromPdfDto, 'fileUrl' | 'answerKeyFileUrl'>,
    @UploadedFiles() files: { file?: Express.Multer.File[]; answerKeyFile?: Express.Multer.File[] },
  ) {
    return this.svc.uploadAndIngest(files?.file?.[0] as any, files?.answerKeyFile?.[0] as any, dto, user.id);
  }

  @Get('ingest-runs') listIngestRuns(@Query('limit') limit?: string) {
    return this.svc.listIngestRuns(limit ? Number(limit) : undefined);
  }
  @Get('ingest-runs/:id') getIngestRunStatus(@Param('id') id: string) {
    return this.svc.getIngestRunStatus(id);
  }

  @Get('questions') listQuestions(@Query() query: ListQuestionsQueryDto) {
    return this.svc.listQuestions(query);
  }
  @Get('questions/verify-queue') listVerifyQueue(@Query('limit') limit?: string) {
    return this.svc.listVerifyQueue(limit ? Number(limit) : undefined);
  }
  @Post('questions') createQuestion(@SchoolUser() user: any, @Body() dto: CreateCompetitiveQuestionDto) {
    return this.svc.createQuestion(dto, user.id);
  }
  @Put('questions/:id/verify') verifyQuestion(@Param('id') id: string, @Body() dto: VerifyQuestionDto) {
    return this.svc.verifyQuestion(id, dto);
  }
  @Post('questions/:id/reject') rejectQuestion(@Param('id') id: string) {
    return this.svc.rejectQuestion(id);
  }
}
