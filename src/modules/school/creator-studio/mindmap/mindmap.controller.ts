import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { MindmapService } from './mindmap.service';
import { GenerateMindmapDto } from './dto/generate-mindmap.dto';
import { SchoolJwtGuard } from '../../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../../guards/school-roles.guard';

@Controller('school/creator-studio/mindmap')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class MindmapController {
  constructor(private readonly mindmapService: MindmapService) {}

  @Post('generate')
  async generate(@Body() dto: GenerateMindmapDto) {
    return this.mindmapService.generateMindmap(dto.topic);
  }
}
