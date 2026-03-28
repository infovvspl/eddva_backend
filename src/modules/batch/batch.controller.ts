import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { BatchService } from './batch.service';
import {
  AttendanceQueryDto,
  BatchListQueryDto,
  CreateBatchDto,
  FlagStudentDto,
  RosterQueryDto,
  UpdateBatchDto,
} from './dto/batch.dto';
import { AssignSubjectTeacherDto, BulkEnrollDto, BulkCreateBatchStudentsDto, CreateBatchStudentDto, EnrollStudentDto, JoinBatchDto } from './dto/enrollment.dto';

@ApiTags('Batch')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('batches')
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  @Post()
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a batch' })
  createBatch(@Body() dto: CreateBatchDto, @TenantId() tenantId: string) {
    return this.batchService.createBatch(dto, tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'List batches for the current role' })
  getBatches(@Query() query: BatchListQueryDto, @CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.batchService.getBatches(query, user, tenantId);
  }

  @Get('dashboard')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get comprehensive institute dashboard stats' })
  getDashboard(@TenantId() tenantId: string) {
    return this.batchService.getDashboardStats(tenantId);
  }

  @Get(':id/roster')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get enrolled student roster for a batch' })
  getRoster(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RosterQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.getRoster(id, query, user, tenantId);
  }

  @Get(':id/attendance')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get batch attendance summary' })
  getAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AttendanceQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.getAttendance(id, query, user, tenantId);
  }

  @Get(':id/live-attendance')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get live attendance: who is active now and who studied today' })
  getLiveAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.getLiveAttendance(id, user, tenantId);
  }

  @Get(':id/performance')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get batch-level performance summary' })
  getPerformance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.getBatchPerformance(id, user, tenantId);
  }

  @Get(':id/subject-teachers')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get subject-teacher assignments for a batch' })
  getSubjectTeachers(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.getSubjectTeachers(id, tenantId);
  }

  @Post(':id/subject-teachers')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Assign a teacher to a subject in a batch (upsert)' })
  assignSubjectTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSubjectTeacherDto,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.assignSubjectTeacher(id, dto, tenantId);
  }

  @Delete(':id/subject-teachers/:assignmentId')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Remove a subject-teacher assignment' })
  removeSubjectTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.removeSubjectTeacher(id, assignmentId, tenantId);
  }

  @Post(':id/students')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a student account and enroll in batch' })
  createAndEnrollStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBatchStudentDto,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.createAndEnrollStudent(id, dto, tenantId);
  }

  @Post(':id/students/bulk')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Bulk create student accounts and enroll in batch' })
  bulkCreateAndEnrollStudents(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkCreateBatchStudentsDto,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.bulkCreateAndEnrollStudents(id, dto, tenantId);
  }

  @Post(':id/enroll')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Enroll one student into a batch' })
  enrollStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollStudentDto,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.enrollStudent(id, dto, tenantId);
  }

  @Post(':id/enroll-bulk')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Bulk enroll students into a batch' })
  bulkEnroll(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkEnrollDto,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.bulkEnrollStudents(id, dto, tenantId);
  }

  @Get(':id/students/:studentId')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get full student detail (profile, engagement, weak topics, lectures, scores)' })
  getStudentDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.getStudentDetail(id, studentId, user, tenantId);
  }

  @Post(':id/students/:studentId/flag')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flag a student — triggers alerts to student, parent (WhatsApp), and admins' })
  flagStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: FlagStudentDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.flagStudent(id, studentId, dto, user.id, tenantId);
  }

  @Get(':id/inactive')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get students not logged in for 3+ days' })
  getInactiveStudents(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.getInactiveStudents(id, user, tenantId);
  }

  @Post(':id/bulk-remind')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send reminder notifications to all inactive students in a batch' })
  sendBulkReminder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.sendBulkReminder(id, user, tenantId);
  }

  @Delete(':id/students/:studentId')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Remove a student from a batch' })
  removeStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.removeStudent(id, studentId, tenantId);
  }

  @Post(':id/invite-link')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Generate a single-use invite link for a batch' })
  generateInviteLink(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.generateInviteLink(id, tenantId);
  }

  @Post('join')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Join a batch via invite token' })
  joinBatch(@Body() dto: JoinBatchDto, @CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.batchService.joinBatchByToken(dto.token, user.id, tenantId);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string' })
  @ApiOperation({ summary: 'Get one batch with teacher and student count' })
  getBatchById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.getBatchById(id, user, tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a batch' })
  updateBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBatchDto,
    @TenantId() tenantId: string,
  ) {
    return this.batchService.updateBatch(id, dto, tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft delete a batch' })
  deleteBatch(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string) {
    return this.batchService.deleteBatch(id, tenantId);
  }
}
