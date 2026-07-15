import { Module } from '@nestjs/common';
import { SchoolPptController } from './school-ppt.controller';
import { SchoolPptService } from './school-ppt.service';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';

@Module({
  imports: [AiBridgeModule],
  controllers: [SchoolPptController],
  providers: [SchoolPptService],
})
export class SchoolPptModule {}
