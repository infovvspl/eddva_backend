import { Controller, Get, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { CompetitiveFeatureGuard } from './competitive-feature.guard';
import { CompetitiveStudentService } from './competitive-student.service';

@Controller('school/competitive/student')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, CompetitiveFeatureGuard)
@SchoolRoles('STUDENT')
export class CompetitiveStudentController {
  constructor(private readonly svc: CompetitiveStudentService) {}

  @Get('subjects') listForStudent(@SchoolUser() user: any) {
    return this.svc.listForStudent(user);
  }
}
