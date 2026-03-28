import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

import { AssessmentService } from './assessment.service';
import { CreateMockTestDto, MockTestListQueryDto, UpdateMockTestDto } from './dto/mock-test.dto';
import { AnswerQuestionDto } from './dto/answer.dto';
import { SessionListQueryDto, StartSessionDto } from './dto/session.dto';

@ApiTags('Assessment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assessments')
export class AssessmentController {
  constructor(private readonly assessmentService: AssessmentService) {}

  @Post('mock-tests')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a mock test' })
  createMockTest(
    @Body() dto: CreateMockTestDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.createMockTest(dto, user, tenantId);
  }

  @Get('mock-tests')
  @ApiOperation({ summary: 'List mock tests' })
  getMockTests(
    @Query() query: MockTestListQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.getMockTests(query, user, tenantId);
  }

  @Get('mock-tests/:id')
  @ApiOperation({ summary: 'Get a mock test by id' })
  @ApiParam({ name: 'id', type: 'string' })
  getMockTestById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.getMockTestById(id, user, tenantId);
  }

  @Patch('mock-tests/:id')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a mock test' })
  updateMockTest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMockTestDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.updateMockTest(id, dto, user, tenantId);
  }

  @Delete('mock-tests/:id')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a mock test' })
  deleteMockTest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.deleteMockTest(id, user, tenantId);
  }

  @Get('diagnostic/status')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get diagnostic completion status for the current student' })
  getDiagnosticStatus(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.getDiagnosticStatus(user.id, tenantId);
  }

  @Post('diagnostic/generate')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Auto-generate a diagnostic test session from the question bank' })
  generateDiagnosticSession(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.generateDiagnosticSession(user.id, tenantId);
  }

  @Post('sessions/start')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Start a test session' })
  startSession(
    @Body() dto: StartSessionDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.startSession(dto, user.id, tenantId);
  }

  @Post('sessions/:id/answer')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Save or update an answer attempt' })
  answerQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnswerQuestionDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.answerQuestion(id, dto, user.id, tenantId);
  }

  @Post('sessions/:id/submit')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Submit a test session' })
  submitSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.submitSession(id, user.id, tenantId);
  }

  @Get('sessions/:id/result')
  @ApiOperation({ summary: 'Get session result and analysis' })
  getSessionResult(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.getSessionResult(id, user, tenantId);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get a session by id' })
  getSessionById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.getSessionById(id, user, tenantId);
  }

  @Get('mock-tests/:id/question-stats')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get per-question accuracy stats for a mock test' })
  @ApiParam({ name: 'id', type: 'string' })
  getMockTestQuestionStats(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.getMockTestQuestionStats(id, tenantId);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List sessions' })
  getSessions(
    @Query() query: SessionListQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.getSessions(query, user, tenantId);
  }

  @Get('progress/topic/:topicId')
  @ApiOperation({ summary: 'Get topic progress' })
  getTopicProgress(
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.assessmentService.getTopicProgress(topicId, user, tenantId, studentId);
  }

  @Get('progress/overview')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get grouped topic progress overview for the current student' })
  getProgressOverview(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.assessmentService.getProgressOverview(user.id, tenantId);
  }

  @Get('progress/report')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Full subject→chapter→topic progress report for the current student' })
  getProgressReport(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.assessmentService.getProgressReport(user, tenantId);
  }

  @Get('progress/report/student/:studentId')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Full progress report for a student (teacher / admin)' })
  @ApiParam({ name: 'studentId', type: 'string' })
  getProgressReportForStudent(
    @Param('studentId') studentId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.assessmentService.getProgressReport(user, tenantId, studentId);
  }
}
