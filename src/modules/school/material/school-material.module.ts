import { Module } from '@nestjs/common';
import { SchoolMaterialService } from './school-material.service';
import { SchoolMaterialController } from './school-material.controller';
import { UploadModule } from '../../upload/upload.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';

@Module({
  imports: [UploadModule, AiBridgeModule],
  controllers: [SchoolMaterialController],
  providers: [SchoolMaterialService],
})
export class SchoolMaterialModule {}
