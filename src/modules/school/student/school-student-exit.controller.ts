import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { SchoolStudentExitService } from './school-student-exit.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';

@Controller('school/students')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
@RequireAdminModule('students')
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
