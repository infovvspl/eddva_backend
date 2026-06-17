import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SchoolAssignmentService } from './school-assignment.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

const uploadStorage = memoryStorage();

@Controller('school/assignments')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAssignmentController {
  constructor(private readonly svc: SchoolAssignmentService) { }

  @Get()
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  list(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.list(user, query);
  }

  @Get('submissions/inbox')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  listInbox(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.listInbox(user, query);
  }

  @Post('upload-url')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  presignUpload(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.presignImageUpload(user, body);
  }

  @Post('ai-generate')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  aiGenerate(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.aiGenerateDraft(user, body);
  }

  @Post('from-image')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  fromImage(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.generateFromImage(user, body);
  }

  @Post()
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage }))
  create(
    @SchoolUser() user: any,
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.svc.create(user, body, file);
  }

  @Post(':id/submit')
  @SchoolRoles('STUDENT')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage }))
  submit(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.svc.submit(user, id, file, body);
  }

  @Get(':id/submissions')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  getSubmissions(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getSubmissions(user, id);
  }

  @Post(':id/submissions/:submissionId/grade')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  gradeSubmission(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Body() body: any,
  ) {
    return this.svc.gradeSubmission(user, id, submissionId, body);
  }

  @Get('submissions/:submissionId/file')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  getSubmissionFile(
    @SchoolUser() user: any,
    @Param('submissionId') submissionId: string,
  ) {
    return this.svc.resolveSubmissionFile(user, submissionId);
  }

  @Get(':id')
  @SchoolRoles('STUDENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Put(':id')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
