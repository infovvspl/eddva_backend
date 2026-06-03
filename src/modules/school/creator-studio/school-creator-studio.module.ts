import { Module } from '@nestjs/common';
import { SchoolCreatorStudioService } from './school-creator-studio.service';
import { SchoolCreatorStudioController } from './school-creator-studio.controller';
import { MindmapController } from './mindmap/mindmap.controller';
import { MindmapService } from './mindmap/mindmap.service';
import { PptController } from './ppt/ppt.controller';
import { PptService } from './ppt/ppt.service';
import { PptAiService } from './ppt/ppt-ai.service';
import { PptGeneratorService } from './ppt/ppt-generator.service';

@Module({ 
  controllers: [SchoolCreatorStudioController, MindmapController, PptController], 
  providers: [SchoolCreatorStudioService, MindmapService, PptService, PptAiService, PptGeneratorService] 
})
export class SchoolCreatorStudioModule {}
