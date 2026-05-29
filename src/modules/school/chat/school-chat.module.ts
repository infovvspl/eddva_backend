import { Module } from '@nestjs/common';
import { SchoolChatService } from './school-chat.service';
import { SchoolChatController } from './school-chat.controller';

@Module({ controllers: [SchoolChatController], providers: [SchoolChatService] })
export class SchoolChatModule {}
