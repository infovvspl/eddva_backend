import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolClassService } from './school-class.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/classes')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolClassController {
  constructor(private readonly svc: SchoolClassService) {}

  @Get('recordings')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  listRecordings(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }

  @Post('recordings/upload-url')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  presignRecording(@SchoolUser() user: any, @Body() body: any) { return this.svc.presignUpload(user, body); }

  @Post('recordings')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  createRecording(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Delete('recordings/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  removeRecording(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.remove(user, id); }
}
