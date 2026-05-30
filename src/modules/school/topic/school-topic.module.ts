import { Module } from '@nestjs/common';
import { SchoolTopicService } from './school-topic.service';
import { SchoolTopicController } from './school-topic.controller';

@Module({ controllers: [SchoolTopicController], providers: [SchoolTopicService] })
export class SchoolTopicModule {}
