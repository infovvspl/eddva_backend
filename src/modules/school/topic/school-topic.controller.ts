import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolTopicService } from './school-topic.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';

@Controller('school/topics')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolTopicController {
  constructor(private readonly svc: SchoolTopicService) {}

  @Get() listTopics(@Query() query: any) { return this.svc.listTopics(query); }
  @Post() createTopic(@Body() body: any) { return this.svc.createTopic(body); }
  @Put(':id') updateTopic(@Param('id') id: string, @Body() body: any) { return this.svc.updateTopic(id, body); }
  @Delete(':id') deleteTopic(@Param('id') id: string) { return this.svc.deleteTopic(id); }

  @Get('chapters') listChapters(@Query() query: any) { return this.svc.listChapters(query); }
  @Post('chapters') createChapter(@Body() body: any) { return this.svc.createChapter(body); }
  @Put('chapters/:id') updateChapter(@Param('id') id: string, @Body() body: any) { return this.svc.updateChapter(id, body); }
  @Delete('chapters/:id') deleteChapter(@Param('id') id: string) { return this.svc.deleteChapter(id); }
}
