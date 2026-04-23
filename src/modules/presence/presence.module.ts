import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LiveSession } from '../../database/entities/live-class.entity';
import { Student } from '../../database/entities/student.entity';
import { Enrollment, Batch } from '../../database/entities/batch.entity';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

@Module({
  imports: [TypeOrmModule.forFeature([LiveSession, Student, Enrollment, Batch])],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
