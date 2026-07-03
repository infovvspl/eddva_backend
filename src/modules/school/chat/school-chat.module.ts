import { Module } from '@nestjs/common';
import { SchoolChatService } from './school-chat.service';
import { SchoolChatController } from './school-chat.controller';
import { SchoolChatGateway } from './school-chat.gateway';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { UploadModule } from '../../upload/upload.module';

@Module({
  imports: [SchoolNotificationModule, UploadModule],
  controllers: [SchoolChatController],
  providers: [SchoolChatService, SchoolChatGateway],
  exports: [SchoolChatGateway],
})
export class SchoolChatModule {}

