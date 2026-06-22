import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolNoticeService } from './school-notice.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { Audit } from '../../audit-log/audit.decorator';

@Controller('school/notices')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolNoticeController {
  constructor(private readonly svc: SchoolNoticeService) {}

  @Get('platform')
  @SchoolRoles('SUPER_ADMIN')
  listPlatform(@Query() query: any) { return this.svc.listPlatform(query); }

  @Post('broadcast')
  @Audit({ module: 'Communication', action: 'Broadcast Sent', description: 'Sent system-wide notice broadcast: {body.title}' })
  @SchoolRoles('SUPER_ADMIN')
  broadcast(@SchoolUser() user: any, @Body() body: any) { return this.svc.broadcast(user, body); }

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }

  @Post()
  @Audit({ module: 'Communication', action: 'Notice Published', description: 'Published notice: {body.title}' })
  create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Put(':id')
  @Audit({ module: 'Communication', action: 'Notice Edit', description: 'Updated notice ID {params.id}' })
  update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }

  @Delete(':id')
  @Audit({ module: 'Communication', action: 'Notice Delete', description: 'Deleted notice ID {params.id}' })
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
