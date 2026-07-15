import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { GamificationService } from './gamification.service';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';

@UseGuards(SchoolJwtGuard, SchoolFeatureGuard)
@Controller('school/gamification')
export class SchoolGamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Get('quiz-rush/start')
  @SchoolFeature('ai', 'ai_game_quizzes')
  startQuizRush(@Req() req: Request, @Query() query: any) {
    return this.gamification.startQuizRush((req as any).user, query);
  }

  @Post('quiz-rush/submit')
  submitQuizRush(@Req() req: Request, @Body() body: any) {
    return this.gamification.submitQuizRush((req as any).user, body);
  }

  @Get('quiz-rush/leaderboard')
  quizRushLeaderboard(@Req() req: Request) {
    return this.gamification.leaderboard((req as any).user, 'quiz_rush');
  }

  @Get('treasure/maps')
  getTreasureMaps(@Req() req: Request) {
    return this.gamification.getTreasureMaps((req as any).user);
  }

  @Get('treasure/challenge')
  @SchoolFeature('ai', 'ai_game_quizzes')
  getTreasureChallenge(@Req() req: Request, @Query('questId') questId: string, @Query('stageOrder') stageOrder?: string) {
    return this.gamification.getTreasureChallenge((req as any).user, questId, Number(stageOrder || 1));
  }

  @Post('treasure/complete')
  completeTreasureStage(@Req() req: Request, @Body() body: any) {
    return this.gamification.completeTreasureStage((req as any).user, body);
  }

  @Get('math-sprint/start')
  @SchoolFeature('ai', 'ai_game_quizzes')
  startMathSprint(@Req() req: Request, @Query('difficulty') difficulty: string) {
    return this.gamification.startMathSprint((req as any).user, difficulty || 'medium');
  }

  @Post('math-sprint/submit')
  submitMathSprint(@Req() req: Request, @Body() body: any) {
    return this.gamification.submitMathSprint((req as any).user, body);
  }

  @Get('math-sprint/leaderboard')
  mathSprintLeaderboard(@Req() req: Request) {
    return this.gamification.leaderboard((req as any).user, 'math_sprint');
  }

  @Get('memory-match/decks')
  getMemoryMatchDecks(@Req() req: Request) {
    return this.gamification.getMemoryMatchDecks((req as any).user);
  }

  @Get('memory-match/start')
  @SchoolFeature('ai', 'ai_game_quizzes')
  startMemoryMatch(@Req() req: Request, @Query('deckId') deckId: string, @Query('difficulty') difficulty?: string) {
    return this.gamification.startMemoryMatch((req as any).user, deckId, difficulty);
  }

  @Post('memory-match/submit')
  submitMemoryMatch(@Req() req: Request, @Body() body: any) {
    return this.gamification.submitMemoryMatch((req as any).user, body);
  }

  @Get('memory-match/leaderboard')
  memoryMatchLeaderboard(@Req() req: Request) {
    return this.gamification.leaderboard((req as any).user, 'memory_match');
  }

  @Get('word-master/decks')
  getWordMasterDecks(@Req() req: Request) {
    return this.gamification.getWordMasterDecks((req as any).user);
  }

  @Get('word-master/start')
  @SchoolFeature('ai', 'ai_game_quizzes')
  startWordMaster(@Req() req: Request, @Query('deckId') deckId: string, @Query('difficulty') difficulty?: string) {
    return this.gamification.startWordMaster((req as any).user, deckId, difficulty);
  }

  @Post('word-master/submit')
  submitWordMaster(@Req() req: Request, @Body() body: any) {
    return this.gamification.submitWordMaster((req as any).user, body);
  }

  @Get('word-master/leaderboard')
  wordMasterLeaderboard(@Req() req: Request) {
    return this.gamification.leaderboard((req as any).user, 'word_master');
  }

  /** Returns the authenticated student's real-time XP, coins, level, and badges */
  @Get('my-profile')
  getMyProfile(@Req() req: Request) {
    return this.gamification.getMyProfile((req as any).user);
  }
}
