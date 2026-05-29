import { Module } from '@nestjs/common';
import { SchoolEventService } from './school-event.service';
import { SchoolEventController } from './school-event.controller';

@Module({ controllers: [SchoolEventController], providers: [SchoolEventService] })
export class SchoolEventModule {}
