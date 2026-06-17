import { Body, Controller, Delete, Get, Header, Param, Post, Put, Query, UseGuards, Patch } from '@nestjs/common';
import { SchoolMaterialService } from './school-material.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school/materials')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolMaterialController {
  constructor(private readonly svc: SchoolMaterialService) { }

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }

  @Post('upload-url')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  presignUpload(@SchoolUser() user: any, @Body() body: any) { return this.svc.presignUpload(user, body); }

  @Post('ai-generate')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  aiGenerate(@SchoolUser() user: any, @Body() body: any) { return this.svc.generateAiContent(user, body); }

  @Post('ai-save')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  aiSave(@SchoolUser() user: any, @Body() body: any) { return this.svc.saveAiMaterial(user, body); }

  // @Get('audit-data')
  // @SchoolRoles('SUPER_ADMIN')
  // async auditMaterialData() {
  //   return this.svc.auditMaterialData();
  // }

  @Post('dump')
  dumpData(@Body() body: any) {
    const fs = require('fs');
    fs.writeFileSync('C:\\EDDVA SCHOOL\\eddva_backend\\frontend-dump.json', JSON.stringify(body, null, 2));
    return { success: true };
  }

  @Post('migrations/ai-tags')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  aiSlideImage(@SchoolUser() user: any, @Body() body: any) { return this.svc.generateSlideImage(user, body); }

  @Post()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Get(':id/highlights')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  getHighlights(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.getHighlights(user, id); }

  @Post(':id/highlights')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  saveHighlight(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.saveHighlight(user, id, body); }

  @Patch(':id/highlights/:highlightId')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  updateHighlight(@SchoolUser() user: any, @Param('id') id: string, @Param('highlightId') highlightId: string, @Body() body: any) { return this.svc.updateHighlight(user, id, highlightId, body); }

  @Delete(':id/highlights/:highlightId')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  deleteHighlight(@SchoolUser() user: any, @Param('id') id: string, @Param('highlightId') highlightId: string) { return this.svc.deleteHighlight(user, id, highlightId); }

  @Get(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT')
  findOne(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.findOne(user, id); }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  update(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) { return this.svc.update(user, id, body); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  remove(@SchoolUser() user: any, @Param('id') id: string) { return this.svc.remove(user, id); }
}
