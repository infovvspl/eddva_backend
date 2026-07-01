import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request, ParseUUIDPipe } from '@nestjs/common';
import { RecordingHighlightService } from './recording-highlight.service';
import { CreateHighlightDto } from './recording-highlight.dto';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';

@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@Controller('school/recordings/:recordingId/highlights')
export class RecordingHighlightController {
  constructor(private readonly highlightService: RecordingHighlightService) {}

  @Get()
  @SchoolRoles('TEACHER', 'STUDENT')
  getHighlights(
    @SchoolUser() user: any,
    @Param('recordingId', ParseUUIDPipe) recordingId: string,
  ) {
    return this.highlightService.getHighlights(recordingId, user);
  }

  @Post()
  @SchoolRoles('TEACHER')
  createHighlight(
    @SchoolUser() user: any,
    @Param('recordingId', ParseUUIDPipe) recordingId: string,
    @Body() dto: CreateHighlightDto,
  ) {
    console.log('HIGHLIGHT DEBUG user object:', JSON.stringify(user));
    return this.highlightService.createHighlight(recordingId, user, dto);
  }

  @Delete(':highlightId')
  @SchoolRoles('TEACHER')
  deleteHighlight(
    @SchoolUser() user: any,
    @Param('recordingId', ParseUUIDPipe) recordingId: string,
    @Param('highlightId', ParseUUIDPipe) highlightId: string,
  ) {
    return this.highlightService.deleteHighlight(recordingId, highlightId, user);
  }
}
