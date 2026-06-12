import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GamificationService } from './gamification.service';
import { GamificationApiController } from './gamification-api.controller';
import { Student } from '../../database/entities/student.entity';
import { GamificationHistory } from '../../database/entities/gamification.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, GamificationHistory], 'coaching'),
    NotificationModule,
  ],
  controllers: [GamificationApiController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
