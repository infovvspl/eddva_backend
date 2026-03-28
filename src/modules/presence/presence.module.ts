import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LiveSession } from '../../database/entities/live-class.entity';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

@Module({
  imports: [TypeOrmModule.forFeature([LiveSession])],
  controllers: [PresenceController],
  providers: [PresenceService],
})
export class PresenceModule {}
