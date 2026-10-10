import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SchoolTopicService } from './school-topic.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/topics')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolTopicController {
  constructor(private readonly svc: SchoolTopicService) {}

  @Get()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'SCHOOL_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF', 'PRINCIPAL')
  listTopics(@Query() query: any) { return this.svc.listTopics(query); }

  @Post()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'SCHOOL_ADMIN', 'ADMIN', 'TEACHER')
  createTopic(@SchoolUser() user: any, @Body() body: any) { return this.svc.createTopic(user, body); }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'SCHOOL_ADMIN', 'ADMIN', 'TEACHER')
  updateTopic(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.updateTopic(user, id, body); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'SCHOOL_ADMIN', 'ADMIN', 'TEACHER')
  deleteTopic(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.deleteTopic(user, id); }

  @Get('chapters')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'SCHOOL_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF', 'PRINCIPAL')
  listChapters(@Query() query: any) { return this.svc.listChapters(query); }

  @Post('bulk-import')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  bulkImport(@SchoolUser() user: any, @Body() body: any) { return this.svc.bulkImport(user, body); }

  @Post('bulk-import/parse-image')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  @UseInterceptors(FileInterceptor('image', {
    storage: memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
  }))
  parseIndexImage(@SchoolUser() user: any, @UploadedFile() file: Express.Multer.File, @Body() body: any) {
    if (!file) throw new BadRequestException('No image uploaded');
    return this.svc.parseIndexImage(user, file, body?.language);
  }

  @Post('chapters')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  createChapter(@SchoolUser() user: any, @Body() body: any) { return this.svc.createChapter(user, body); }

  @Put('chapters/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  updateChapter(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.updateChapter(user, id, body); }

  @Delete('chapters/:id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  deleteChapter(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.deleteChapter(user, id); }
}
