import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { StudentService } from './student.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Student')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('students')
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  @Get('dashboard')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Student dashboard — rank, plan, weak topics, streak' })
  getDashboard(@CurrentUser('id') userId: string, @TenantId() tenantId: string) {
    return this.studentService.getDashboard(userId, tenantId);
  }

  @Get('weak-topics')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get weak topics with severity and chapter context' })
  getWeakTopics(@CurrentUser('id') userId: string) {
    return this.studentService.getWeakTopics(userId);
  }

  // ─── COURSE DASHBOARD ────────────────────────────────────────────────────────

  @Get('my-courses')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'List all enrolled courses with progress overview' })
  getMyCourses(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.studentService.getMyCourses(user.id, tenantId);
  }

  @Get('my-courses/:batchId')
  @Roles(UserRole.STUDENT)
  @ApiParam({ name: 'batchId', type: 'string' })
  @ApiOperation({ summary: 'Full course curriculum: subjects → chapters → topics with resources, lectures & progress' })
  getCourseDetail(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studentService.getCourseDetail(batchId, user.id, tenantId);
  }

  @Get('my-courses/:batchId/topics/:topicId')
  @Roles(UserRole.STUDENT)
  @ApiParam({ name: 'batchId', type: 'string' })
  @ApiParam({ name: 'topicId', type: 'string' })
  @ApiOperation({ summary: 'Topic detail — lectures list, resources, and student progress' })
  getTopicDetail(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studentService.getTopicDetail(batchId, topicId, user.id, tenantId);
  }

  // ─── CONTINUE LEARNING ───────────────────────────────────────────────────────

  @Get('continue-learning')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get last in-progress lecture to resume, or next unwatched lecture' })
  getContinueLearning(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.studentService.getContinueLearning(user.id, tenantId);
  }

  // ─── WEEKLY ACTIVITY ─────────────────────────────────────────────────────────

  @Get('weekly-activity')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: '7-day activity chart — lectures watched, topics completed, tests taken per day' })
  getWeeklyActivity(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.studentService.getWeeklyActivity(user.id, tenantId);
  }

  // ─── PROFILE ─────────────────────────────────────────────────────────────────

  @Get('profile')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get student profile' })
  getProfile(@CurrentUser() user: any) {
    return this.studentService.getProfile(user.id);
  }

  @Patch('profile')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Update student profile (personal info, preferences)' })
  updateProfile(@CurrentUser() user: any, @Body() body: any) {
    return this.studentService.updateProfile(user.id, body);
  }

  // ─── DISCOVER BATCHES (login modal) ──────────────────────────────────────────

  @Get('discover-batches')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Discover all available batches across all institutes — shown on first login' })
  discoverBatches(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.studentService.discoverBatches(user.id, tenantId);
  }

  @Post('enroll/:batchId')
  @Roles(UserRole.STUDENT)
  @ApiParam({ name: 'batchId', type: 'string' })
  @ApiOperation({ summary: 'Self-enroll in a batch (cross-institute)' })
  enrollInBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @CurrentUser() user: any,
  ) {
    return this.studentService.enrollInBatch(user.id, batchId);
  }

  @Get('batches/:batchId')
  @Roles(UserRole.STUDENT)
  @ApiParam({ name: 'batchId', type: 'string' })
  @ApiOperation({ summary: 'Public batch preview — no enrollment required' })
  getBatchPreview(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @CurrentUser() user: any,
  ) {
    return this.studentService.getBatchPreview(batchId, user.id);
  }
}
