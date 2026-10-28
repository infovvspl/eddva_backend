import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CompetitiveMasterService } from '../school/competitive/competitive-master.service';
import {
  CreateMasterChapterDto,
  CreateMasterExamDto,
  CreateMasterSubjectDto,
  CreateMasterTopicDto,
  UpdateMasterExamDto,
  UpdateMasterSubjectDto,
  VerifyQuestionDto,
} from '../school/competitive/dto/competitive-master.dto';
import { assertInternalKey } from './internal-key';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Competitive exam prep, Super Admin side, for the platform console: the Exam > Subject > Chapter > Topic taxonomy,
 * extracting questions from a PYQ / question-bank PDF (the AI service reads the pages and the questions land in a
 * verify queue), and approving or rejecting them. It calls the same service the LMS super admin uses.
 * The lists return the rows themselves (the service wraps them in { data }).
 */
@Controller('internal/platform/competitive')
export class InternalPlatformCompetitiveController {
  constructor(private readonly svc: CompetitiveMasterService) {}

  // ── Exams ──
  @Get('exams') async exams(@Headers('x-internal-key') key: string) { assertInternalKey(key); return (await this.svc.listExams()).data; }
  @Post('exams') @HttpCode(201) createExam(@Headers('x-internal-key') key: string, @Body() dto: CreateMasterExamDto) { assertInternalKey(key); return this.svc.createExam(dto); }
  @Put('exams/:id') @HttpCode(200) updateExam(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMasterExamDto) { assertInternalKey(key); return this.svc.updateExam(id, dto); }
  @Delete('exams/:id') @HttpCode(200) deleteExam(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) { assertInternalKey(key); return this.svc.deleteExam(id); }

  // ── Subjects ──
  @Get('subjects') async subjects(@Headers('x-internal-key') key: string, @Query('examId') examId?: string) { assertInternalKey(key); return (await this.svc.listSubjects(examId)).data; }
  @Post('subjects') @HttpCode(201) createSubject(@Headers('x-internal-key') key: string, @Body() dto: CreateMasterSubjectDto) { assertInternalKey(key); return this.svc.createSubject(dto); }
  @Put('subjects/:id') @HttpCode(200) updateSubject(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMasterSubjectDto) { assertInternalKey(key); return this.svc.updateSubject(id, dto); }
  @Delete('subjects/:id') @HttpCode(200) deleteSubject(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) { assertInternalKey(key); return this.svc.deleteSubject(id); }

  // ── Chapters ──
  @Get('chapters') async chapters(@Headers('x-internal-key') key: string, @Query('masterSubjectId') subjectId: string) { assertInternalKey(key); return (await this.svc.listChapters(subjectId)).data; }
  @Post('chapters') @HttpCode(201) createChapter(@Headers('x-internal-key') key: string, @Body() dto: CreateMasterChapterDto) { assertInternalKey(key); return this.svc.createChapter(dto); }
  @Delete('chapters/:id') @HttpCode(200) deleteChapter(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) { assertInternalKey(key); return this.svc.deleteChapter(id); }

  // ── Topics ──
  @Get('topics') async topics(@Headers('x-internal-key') key: string, @Query('masterChapterId') chapterId: string) { assertInternalKey(key); return (await this.svc.listTopics(chapterId)).data; }
  @Post('topics') @HttpCode(201) createTopic(@Headers('x-internal-key') key: string, @Body() dto: CreateMasterTopicDto) { assertInternalKey(key); return this.svc.createTopic(dto); }
  @Delete('topics/:id') @HttpCode(200) deleteTopic(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) { assertInternalKey(key); return this.svc.deleteTopic(id); }

  // ── Train from a PDF ──
  /** Uploads the paper (and an optional separate answer key) and starts the background extraction; returns the run id at once. */
  @Post('ingest')
  @HttpCode(200)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'file', maxCount: 1 }, { name: 'answerKeyFile', maxCount: 1 }], { storage: memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } }))
  ingest(
    @Headers('x-internal-key') key: string,
    @Body() body: { masterSubjectId?: string; examYear?: string; source?: string; actorId?: string },
    @UploadedFiles() files: { file?: Express.Multer.File[]; answerKeyFile?: Express.Multer.File[] },
  ) {
    assertInternalKey(key);
    if (!body?.masterSubjectId || !UUID.test(body.masterSubjectId)) throw new BadRequestException('masterSubjectId is required');
    if (body.source !== 'pyq' && body.source !== 'question_bank') throw new BadRequestException("source must be 'pyq' or 'question_bank'");
    const year = body.examYear ? Number(body.examYear) : undefined;
    if (year !== undefined && (!Number.isInteger(year) || year < 1950 || year > 2100)) throw new BadRequestException('examYear must be a four-digit year');
    return this.svc.uploadAndIngest(files?.file?.[0] as any, files?.answerKeyFile?.[0] as any, { masterSubjectId: body.masterSubjectId, examYear: year, source: body.source }, body.actorId && UUID.test(body.actorId) ? body.actorId : (undefined as unknown as string));
  }

  @Get('ingest-runs') async runs(@Headers('x-internal-key') key: string, @Query('limit') limit?: string) { assertInternalKey(key); return (await this.svc.listIngestRuns(limit ? Number(limit) : undefined)); }
  @Get('ingest-runs/:id') run(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) { assertInternalKey(key); return this.svc.getIngestRunStatus(id); }

  // ── Verify queue ──
  @Get('questions/verify-queue') async queue(@Headers('x-internal-key') key: string, @Query('limit') limit?: string) { assertInternalKey(key); return (await this.svc.listVerifyQueue(limit ? Number(limit) : undefined)).data; }
  @Put('questions/:id/verify') @HttpCode(200) verify(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyQuestionDto) { assertInternalKey(key); return this.svc.verifyQuestion(id, dto); }
  @Post('questions/:id/reject') @HttpCode(200) reject(@Headers('x-internal-key') key: string, @Param('id', ParseUUIDPipe) id: string) { assertInternalKey(key); return this.svc.rejectQuestion(id); }
}
