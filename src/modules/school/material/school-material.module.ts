import { Module } from '@nestjs/common';
import { SchoolTextbookModule } from '../textbook/school-textbook.module';
import { SchoolMaterialService } from './school-material.service';
import { SchoolMaterialController } from './school-material.controller';
import { UploadModule } from '../../upload/upload.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { InternalModule } from '../../internal/internal.module';

@Module({
  imports: [SchoolTextbookModule, UploadModule, AiBridgeModule, SchoolNotificationModule, InternalModule],
  controllers: [SchoolMaterialController],
  providers: [SchoolMaterialService],
})
export class SchoolMaterialModule {}

