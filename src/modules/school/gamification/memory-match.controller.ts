import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { MemoryMatchService } from './memory-match.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';

@UseGuards(SchoolJwtGuard)
@Controller('school/gamification/memory-match')
export class MemoryMatchController {
  constructor(private readonly memoryMatchService: MemoryMatchService) {}

  @Get('leaderboard')
  async getLeaderboard() {
    return this.memoryMatchService.getLeaderboard();
  }

  @Post('submit')
  async submitScore(
    @Req() req: Request,
    @Body('turnsCount') turnsCount: number,
    @Body('mismatchesCount') mismatchesCount: number,
    @Body('sessionId') sessionId: string,
  ) {
    const user = (req as any).user;
    
    // In a fully integrated system, fetch session from GamesService to get deckName & calculate XP
    // For now, use fallback XP calculation based on turns and a generic deck name
    const minPossibleTurns = 8;
    const baseXp = minPossibleTurns * 10;
    const extraTurns = Math.max(0, turnsCount - minPossibleTurns);
    const efficiencyBonus = Math.max(0, 100 - extraTurns * 6);
    const xp = baseXp + efficiencyBonus;
    
    await this.memoryMatchService.saveScore(
      user.id, 
      xp, 
      'Memory Match Deck', 
      turnsCount, 
      mismatchesCount
    );

    return {
      turnsCount,
      mismatchesCount,
      score: xp,
      xpEarned: xp,
      coinsEarned: minPossibleTurns + (extraTurns <= 3 ? 5 : (extraTurns <= 6 ? 2 : 0)),
      hasLeveledUp: false,
      newLevel: 1,
      newTitle: 'Beginner',
      badgeUnlocked: false,
      currentXp: xp,
      currentCoins: 100,
      levelProgress: 50,
    };
  }
}
