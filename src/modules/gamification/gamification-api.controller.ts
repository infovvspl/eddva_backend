import { Controller, Get, Post, Body, Param, Req, Query, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { Request } from 'express';
import { GamificationService } from './gamification.service';

@Controller()
export class GamificationApiController {
  constructor(
    private readonly gamificationService: GamificationService,
  ) {}

  private getUserIdFromRequest(req: Request): string {
    if ((req as any).user?.id) {
      return (req as any).user.id;
    }

    let token: string | undefined;

    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      token = auth.slice(7);
    }

    if (!token && (req as any).cookies?.token) {
      token = (req as any).cookies.token;
    }

    if (!token) {
      return 'demo_student_user_123';
    }

    try {
      const schoolSecret = process.env.SCHOOL_JWT_SECRET ||
        (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_school' : 'dev_school_secret_change_in_prod');
      let decoded: any;
      try {
        decoded = jwt.verify(token, schoolSecret);
      } catch {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'change_me_in_production');
      }
      return decoded.id || decoded.sub || 'demo_student_user_123';
    } catch {
      return 'demo_student_user_123';
    }
  }

  @Get('gamification/my-profile')
  async getMyProfile(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.getStudentGamificationProfile(userId);
  }

  @Get(['gamification/dashboard', 'school/gamification/dashboard'])
  async getGamificationDashboard(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.getStudentGamificationProfile(userId);
  }

  @Get(['student/dashboard', 'students/dashboard'])
  async getStudentDashboard(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.getStudentGamificationProfile(userId);
  }

  @Post(['gamification/award-rewards', 'school/gamification/award-rewards'])
  async awardRewards(@Req() req: Request, @Body() body: any) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.awardRewards({
      userId,
      gameType: body.gameType || 'GENERAL_ACTIVITY',
      xpEarned: Number(body.xpEarned || 50),
      coinsEarned: Number(body.coinsEarned || 10),
      score: Number(body.score || 100),
      accuracy: Number(body.accuracy || 85),
      avgSpeedSec: Number(body.avgSpeedSec || 10),
      metadata: body.metadata,
      badgesToUnlock: body.badgesToUnlock,
    });
  }

  @Post(['gamification/wallet/redeem', 'school/gamification/wallet/redeem'])
  async redeemRewardWallet(@Req() req: Request, @Body() body: any) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.requestRewardRedemption(
      userId,
      Number(body.amountInr || 10),
      body.payoutMethod || 'DEMO_PAYMENT_RECEIVE',
      body.payoutDetails || { upiId: 'student@upi' }
    );
  }

  @Get(['gamification/wallet/history', 'school/gamification/wallet/history'])
  async getRewardHistory(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.getRewardHistory(userId);
  }

  @Get(['gamification/ai-memorization', 'school/gamification/ai-memorization'])
  async getAiMemorizationItems(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.getAiMemorizationItems(userId);
  }

  @Get(['gamification/daily-missions', 'school/gamification/daily-missions'])
  async getDailyMissions(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.getDailyMissions(userId);
  }

  @Post(['gamification/daily-missions/:id/claim', 'school/gamification/daily-missions/:id/claim'])
  async claimMissionReward(@Req() req: Request, @Param('id') missionId: string) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.claimMissionReward(userId, missionId);
  }

  @Get(['gamification/achievements', 'school/gamification/achievements'])
  async getAchievements(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.getAchievements(userId);
  }

  @Get(['gamification/leaderboard', 'school/gamification/leaderboard'])
  async getLeaderboard(@Query('scope') scope: string) {
    try {
      const data = await this.gamificationService.getMultiLeaderboard(scope || 'GLOBAL');
      return { success: true, data: Array.isArray(data) ? data : [] };
    } catch (err: any) {
      console.error('[GamificationApiController] Leaderboard error:', err?.message || err);
      return { success: true, data: [] };
    }
  }

  @Get(['school/gamification/admin/redemptions', 'gamification/admin/redemptions'])
  async getAdminRedemptions(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    return this.gamificationService.getRewardHistory(userId);
  }
}
