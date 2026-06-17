import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemoryMatchLeaderboard } from './entities/memory-match-leaderboard.entity';
import { MemoryMatchService } from './memory-match.service';
import { GamificationService } from './gamification.service';
import { SchoolGamificationController } from './gamification.controller';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MemoryMatchLeaderboard], 'school'),
    AiBridgeModule,
  ],
  controllers: [SchoolGamificationController],
  providers: [MemoryMatchService, GamificationService],
  exports: [MemoryMatchService, GamificationService],
})
export class SchoolGamificationModule {}
