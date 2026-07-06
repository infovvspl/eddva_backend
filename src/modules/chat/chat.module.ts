import { Module } from '@nestjs/common';
import { CoachingChatService } from './chat.service';
import { CoachingChatController } from './chat.controller';
import { SchoolChatModule } from '../school/chat/school-chat.module';
import { NotificationModule } from '../notification/notification.module';
import { CoachingChatModule as NewCoachingChatModule } from '../coaching-chat/coaching-chat.module';

@Module({
  imports: [SchoolChatModule, NotificationModule, NewCoachingChatModule],
  controllers: [CoachingChatController],
  providers: [CoachingChatService],
  exports: [CoachingChatService],
})
export class CoachingChatModule {}
