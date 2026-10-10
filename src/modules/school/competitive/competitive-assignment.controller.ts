import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { CompetitiveFeatureGuard } from './competitive-feature.guard';
import { CompetitiveAssignmentService } from './competitive-assignment.service';
import { AssignTeacherDto } from './dto/competitive-subject.dto';

@Controller('school/competitive')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, CompetitiveFeatureGuard)
export class CompetitiveAssignmentController {
  constructor(private readonly svc: CompetitiveAssignmentService) {}

  @Get('subjects/:id/assignments')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  listForSubject(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.listForSubject(user, id);
  }

  @Post('subjects/:id/assignments')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  assign(@SchoolUser() user: any, @Param('id') id: string, @Body() dto: AssignTeacherDto) {
    return this.svc.assign(user, id, dto);
  }

  @Delete('subjects/:id/assignments/:assignmentId')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  unassign(@SchoolUser() user: any, @Param('id') id: string, @Param('assignmentId') assignmentId: string) {
    return this.svc.unassign(user, id, assignmentId);
  }

  // Teacher: "my competitive assignments" — their own teaching-map entry.
  @Get('my-assignments')
  @SchoolRoles('TEACHER')
  listMine(@SchoolUser() user: any) {
    return this.svc.listForTeacher(user);
  }
}
