import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

@Controller('assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssignmentController {
  constructor(private readonly assignmentService: AssignmentService) {}

  @Post('lecture/:lectureId')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER)
  createAssignment(
    @Request() req,
    @Param('lectureId') lectureId: string,
    @Body() body: { title: string; description?: string; attachmentUrl?: string; dueDate?: string; maxMarks?: number }
  ) {
    return this.assignmentService.createAssignment(req.user.tenantId, lectureId, body);
  }

  @Get('lecture/:lectureId')
  getAssignments(@Request() req, @Param('lectureId') lectureId: string) {
    // If student, pass userId so the service can look up the student record
    const userId = req.user.role === UserRole.STUDENT ? req.user.id : undefined;
    return this.assignmentService.getAssignmentsForLecture(req.user.tenantId, lectureId, userId);
  }

  @Get(':id/submissions')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER)
  getSubmissions(@Request() req, @Param('id') assignmentId: string) {
    return this.assignmentService.getSubmissions(req.user.tenantId, assignmentId);
  }

  @Post(':id/submit')
  @Roles(UserRole.STUDENT)
  submitAssignment(
    @Request() req,
    @Param('id') assignmentId: string,
    @Body() body: { submissionUrl: string }
  ) {
    return this.assignmentService.submitAssignment(req.user.tenantId, assignmentId, req.user.id, body.submissionUrl);
  }

  @Post('submissions/:submissionId/grade')
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER)
  gradeSubmission(
    @Request() req,
    @Param('submissionId') submissionId: string,
    @Body() body: { grade: number; feedback?: string }
  ) {
    return this.assignmentService.gradeSubmission(req.user.tenantId, submissionId, body.grade, body.feedback);
  }
}
