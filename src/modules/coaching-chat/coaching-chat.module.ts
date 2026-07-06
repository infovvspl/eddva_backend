import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoachingChatGateway } from './coaching-chat.gateway';

@Module({
  imports: [AuthModule],
  providers: [CoachingChatGateway],
  exports: [CoachingChatGateway],
})
export class CoachingChatModule {}
