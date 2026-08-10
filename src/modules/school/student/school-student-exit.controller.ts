import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { SchoolStudentExitService } from './school-student-exit.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/students')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolStudentExitController {
  constructor(private readonly exitService: SchoolStudentExitService) {}

  @Get(':id/exit-record')
  async getExitRecord(@SchoolUser() user: any, @Param('id') studentId: string) {
    return this.exitService.getExitRecord(user, studentId);
  }

  @Post(':id/exit-record')
  async createOrUpdateExitRecord(
    @SchoolUser() user: any,
    @Param('id') studentId: string,
    @Body() body: any,
  ) {
    return this.exitService.createOrUpdateExitRecord(user, studentId, body);
  }
}
