import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolComplaintService } from './school-complaint.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/complaints')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolComplaintController {
  constructor(private readonly svc: SchoolComplaintService) {}

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Post() create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }
  @Get(':id/messages') listMessages(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.listMessages(user, id); }
  @Post(':id/messages') createMessage(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.createMessage(user, id, body); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
