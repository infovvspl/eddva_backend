import { Module } from '@nestjs/common';
import { CoachingChatService } from './chat.service';
import { CoachingChatController } from './chat.controller';
import { SchoolChatModule } from '../school/chat/school-chat.module';
import { NotificationModule } from '../notification/notification.module';
import { CoachingChatModule as NewCoachingChatModule } from '../coaching-chat/coaching-chat.module';
import { BatchModule } from '../batch/batch.module';

@Module({
  imports: [SchoolChatModule, NotificationModule, NewCoachingChatModule, BatchModule],
  controllers: [CoachingChatController],
  providers: [CoachingChatService],
  exports: [CoachingChatService],
})
export class CoachingChatModule {}
