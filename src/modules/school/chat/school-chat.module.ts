import { Module } from '@nestjs/common';
import { SchoolChatService } from './school-chat.service';
import { SchoolChatController } from './school-chat.controller';
import { SchoolChatGateway } from './school-chat.gateway';

@Module({
  controllers: [SchoolChatController],
  providers: [SchoolChatService, SchoolChatGateway],
})
export class SchoolChatModule {}
