import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolStudentPromotionService } from './school-student-promotion.service';

@Controller('school/student-promotions')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
export class SchoolStudentPromotionController {
  constructor(private readonly svc: SchoolStudentPromotionService) {}

  @Get('overview')
  overview(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.overview(user, query);
  }

  @Get('sections/:sectionId/students')
  sectionStudents(@SchoolUser() user: any, @Param('sectionId') sectionId: string, @Query() query: any) {
    return this.svc.sectionStudents(user, sectionId, query);
  }

  @Post('promote')
  promote(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.promote(user, body);
  }
}
