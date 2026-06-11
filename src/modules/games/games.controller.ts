import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { GamesService } from './games.service';

const GLOBAL_TENANT = '73a505c3-23eb-4166-b019-8c9bc154a284';

@Controller('games')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get('quiz-rush/start')
  @Roles(UserRole.STUDENT)
  async startQuizRush(
    @Query('subjectId') subjectId: string,
    @Query('chapterId') chapterId: string,
    @Query('difficulty') difficulty: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.startQuizRush(
      subjectId,
      chapterId,
      difficulty,
      user.id,
      tenantId || GLOBAL_TENANT,
    );
  }

  @Post('quiz-rush/submit')
  @Roles(UserRole.STUDENT)
  async submitQuizRush(
    @Body() body: { sessionId: string; answers: Array<{ questionId: string; selectedOptionId: string; timeTakenSeconds: number }> },
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.submitQuizRush(
      body.sessionId,
      body.answers,
      user.id,
      tenantId || GLOBAL_TENANT,
    );
  }

  @Get('quiz-rush/leaderboard')
  async getQuizRushLeaderboard(
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.getQuizRushLeaderboard(tenantId || GLOBAL_TENANT);
  }

  @Get('treasure/maps')
  @Roles(UserRole.STUDENT)
  async getTreasureMaps(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.getTreasureMaps(user.id, tenantId || GLOBAL_TENANT);
  }

  @Get('treasure/challenge')
  @Roles(UserRole.STUDENT)
  async getTreasureChallenge(
    @Query('questId') questId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.getTreasureChallenge(questId, user.id, tenantId || GLOBAL_TENANT);
  }

  @Post('treasure/complete')
  @Roles(UserRole.STUDENT)
  async completeTreasureStage(
    @Body() body: { questId: string; answers: Array<{ questionId: string; selectedOptionId: string }> },
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.completeTreasureStage(
      body.questId,
      body.answers,
      user.id,
      tenantId || GLOBAL_TENANT,
    );
  }

  @Get('math-sprint/start')
  @Roles(UserRole.STUDENT)
  async startMathSprint(
    @Query('difficulty') difficulty: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.startMathSprint(difficulty, user.id, tenantId || GLOBAL_TENANT);
  }

  @Post('math-sprint/submit')
  @Roles(UserRole.STUDENT)
  async submitMathSprint(
    @Body() body: { sessionId: string; answers: Array<{ questionId: string; selectedOptionId: string }> },
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.submitMathSprint(
      body.sessionId,
      body.answers,
      user.id,
      tenantId || GLOBAL_TENANT,
    );
  }

  @Get('math-sprint/leaderboard')
  async getMathSprintLeaderboard(
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.getMathSprintLeaderboard(tenantId || GLOBAL_TENANT);
  }

  @Get('memory-match/decks')
  @Roles(UserRole.STUDENT)
  async getMemoryMatchDecks() {
    return this.gamesService.getMemoryMatchDecks();
  }

  @Get('memory-match/start')
  @Roles(UserRole.STUDENT)
  async startMemoryMatch(
    @Query('deckId') deckId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.startMemoryMatch(deckId, user.id, tenantId || GLOBAL_TENANT);
  }

  @Post('memory-match/submit')
  @Roles(UserRole.STUDENT)
  async submitMemoryMatch(
    @Body() body: { sessionId: string; turnsCount: number; mismatchesCount: number },
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.submitMemoryMatch(
      body.sessionId,
      body.turnsCount,
      body.mismatchesCount,
      user.id,
      tenantId || GLOBAL_TENANT,
    );
  }

  @Get('memory-match/leaderboard')
  async getMemoryMatchLeaderboard(
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.getMemoryMatchLeaderboard(tenantId || GLOBAL_TENANT);
  }

  @Get('word-master/decks')
  @Roles(UserRole.STUDENT)
  async getWordMasterDecks() {
    return this.gamesService.getWordMasterDecks();
  }

  @Get('word-master/start')
  @Roles(UserRole.STUDENT)
  async startWordMaster(
    @Query('deckId') deckId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.startWordMaster(deckId, user.id, tenantId || GLOBAL_TENANT);
  }

  @Post('word-master/submit')
  @Roles(UserRole.STUDENT)
  async submitWordMaster(
    @Body() body: { sessionId: string; answers: Array<{ index: number; word: string }> },
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.submitWordMaster(
      body.sessionId,
      body.answers,
      user.id,
      tenantId || GLOBAL_TENANT,
    );
  }

  @Get('word-master/leaderboard')
  async getWordMasterLeaderboard(
    @TenantId() tenantId: string,
  ) {
    return this.gamesService.getWordMasterLeaderboard(tenantId || GLOBAL_TENANT);
  }
}
