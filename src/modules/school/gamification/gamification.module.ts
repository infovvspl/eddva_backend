import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemoryMatchLeaderboard } from './entities/memory-match-leaderboard.entity';
import { MemoryMatchService } from './memory-match.service';
import { MemoryMatchController } from './memory-match.controller';
import { GamificationService } from './gamification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MemoryMatchLeaderboard], 'school'),
  ],
  controllers: [MemoryMatchController],
  providers: [MemoryMatchService, GamificationService],
  exports: [MemoryMatchService, GamificationService],
})
export class SchoolGamificationModule {}
