import { Module } from '@nestjs/common';
import { CoachingChatService } from './chat.service';
import { CoachingChatController } from './chat.controller';
import { SchoolChatModule } from '../school/chat/school-chat.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [SchoolChatModule, NotificationModule],
  controllers: [CoachingChatController],
  providers: [CoachingChatService],
  exports: [CoachingChatService],
})
export class CoachingChatModule {}
