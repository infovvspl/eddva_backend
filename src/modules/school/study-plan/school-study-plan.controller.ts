import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolStudyPlanService } from './school-study-plan.service';

@Controller('school/study-plans')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolStudyPlanController {
  constructor(private readonly service: SchoolStudyPlanService) {}

  @Get('courses')
  getCourses(@SchoolUser() user: any) {
    return this.service.getCourses(user);
  }

  @Post('generate')
  generate(@SchoolUser() user: any, @Body() body: { batchId?: string }) {
    return this.service.generatePlan(user, body.batchId);
  }

  @Post('regenerate')
  regenerate(@SchoolUser() user: any, @Body() body: { batchId?: string }) {
    return this.service.generatePlan(user, body.batchId, true);
  }

  @Post('clear')
  clear(@SchoolUser() user: any, @Body() body: { batchId?: string }) {
    return this.service.clearPlan(user, body.batchId);
  }

  @Get('today')
  getToday(@SchoolUser() user: any, @Query('batchId') batchId?: string) {
    return this.service.getToday(user, batchId);
  }

  @Get()
  getRange(
    @SchoolUser() user: any,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('batchId') batchId?: string,
  ) {
    return this.service.getRange(user, startDate, endDate, batchId);
  }

  @Patch('items/:itemId/complete')
  completeItem(@SchoolUser() user: any, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.service.completeItem(user, itemId);
  }

  @Patch('items/:itemId/skip')
  skipItem(@SchoolUser() user: any, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.service.skipItem(user, itemId);
  }

  @Get('next-action')
  getNextAction(@SchoolUser() user: any, @Query('batchId') batchId?: string) {
    return this.service.getNextAction(user, batchId);
  }

  @Get('revision/spaced')
  getRevisionSpaced(@SchoolUser() user: any, @Query('batchId') batchId?: string) {
    return this.service.getRevisionSpaced(user, batchId);
  }

  @Get('revision/intensive')
  getRevisionIntensive(@SchoolUser() user: any, @Query('batchId') batchId?: string) {
    return this.service.getRevisionIntensive(user, batchId);
  }

  @Get('revision/notes')
  getRevisionNotes(@SchoolUser() user: any, @Query('batchId') batchId?: string) {
    return this.service.getRevisionNotes(user, batchId);
  }

  @Get('revision/practice')
  getRevisionPractice(@SchoolUser() user: any, @Query('batchId') batchId?: string) {
    return this.service.getRevisionPractice(user, batchId);
  }

  @Post('revision-session')
  startRevisionSession(
    @SchoolUser() user: any,
    @Body() body: { topicId: string; accuracy: number; intervalDays: number },
  ) {
    return this.service.startRevisionSession(user, body.topicId, body.accuracy, body.intervalDays);
  }
}
