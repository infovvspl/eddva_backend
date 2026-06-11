import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Repository } from 'typeorm';
import { Cache } from 'cache-manager';
import { Student } from '../../database/entities/student.entity';
import { GamificationHistory } from '../../database/entities/gamification.entity';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class GamificationService {
  constructor(
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(GamificationHistory, 'coaching')
    private readonly historyRepo: Repository<GamificationHistory>,
    private readonly notificationService: NotificationService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Helper to compute level and title based on XP
   * Uses the updated level curve:
   * 0-99: Level 1 (Beginner)
   * 100-249: Level 2 (Learner)
   * 250-499: Level 3 (Scholar)
   * 500-999: Level 4 (Expert)
   * 1000+: Level 5 (Champion)
   */
  calculateLevel(xpTotal: number) {
    let level = 1;
    let title = 'Beginner';

    if (xpTotal >= 1000) {
      level = 5;
      title = 'Champion';
    } else if (xpTotal >= 500) {
      level = 4;
      title = 'Expert';
    } else if (xpTotal >= 250) {
      level = 3;
      title = 'Scholar';
    } else if (xpTotal >= 100) {
      level = 2;
      title = 'Learner';
    }

    return { level, title };
  }

  async awardRewards(params: {
    userId: string;
    tenantId: string;
    gameType: string;
    xpEarned: number;
    coinsEarned: number;
    score: number;
    metadata?: any;
    badgesToUnlock?: string[];
    badgeDescriptions?: Record<string, string>;
  }) {
    const { userId, tenantId, gameType, xpEarned, coinsEarned, score, metadata, badgesToUnlock, badgeDescriptions } = params;

    let student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) {
      // Create student if it doesn't exist
      student = this.studentRepo.create({
        userId,
        tenantId: tenantId || '73a505c3-23eb-4166-b019-8c9bc154a284',
      });
      student = await this.studentRepo.save(student);
    }

    // Update XP and Coins
    student.xpTotal = (student.xpTotal || 0) + xpEarned;
    student.eddvaCoins = (student.eddvaCoins || 0) + coinsEarned;

    // Recalculate Level
    const { level: newLevel, title: newTitle } = this.calculateLevel(student.xpTotal);
    const hasLeveledUp = newLevel > student.currentLevel;
    student.currentLevel = newLevel;

    // Process Badges
    const unlockedBadges = student.unlockedBadges || [];
    let badgeUnlocked = null;

    if (badgesToUnlock && badgesToUnlock.length > 0) {
      for (const badge of badgesToUnlock) {
        if (!unlockedBadges.includes(badge)) {
          unlockedBadges.push(badge);
          student.unlockedBadges = unlockedBadges;
          badgeUnlocked = badge; // Pick the latest unlocked badge for return value

          const description = badgeDescriptions?.[badge] || `You unlocked the ${badge} badge!`;

          await this.notificationService.send({
            userId,
            tenantId,
            title: `🏆 Badge Unlocked: ${badge}`,
            body: description,
            channels: ['in_app'],
            refType: 'badge_unlocked',
            refId: badge.toLowerCase().replace(/\\s+/g, '_'),
          }).catch((err) => console.error('Failed to send badge notification:', err.message));
        }
      }
    }

    // Send Level Up Notification
    if (hasLeveledUp) {
      await this.notificationService.send({
        userId,
        tenantId,
        title: '🎉 Level Up!',
        body: `Congratulations! You have reached Level ${newLevel} (${newTitle})!`,
        channels: ['in_app'],
        refType: 'level_up',
        refId: String(newLevel),
      }).catch((err) => console.error('Failed to send level-up notification:', err.message));
    }

    // Save Student Profile
    await this.studentRepo.save(student);

    // Save Reward History
    const historyEntry = this.historyRepo.create({
      studentId: student.id,
      gameType,
      xpEarned,
      coinsEarned,
      score,
      metadata,
    });
    await this.historyRepo.save(historyEntry);

    // Clear Dashboard Cache so frontend sees fresh data immediately
    const cacheKey = `dashboard:${userId}`;
    await this.cacheManager.del(cacheKey);

    let levelProgress = 0;
    if (student.xpTotal >= 1000) levelProgress = 100;
    else if (student.xpTotal >= 500) levelProgress = Math.round(((student.xpTotal - 500) / 500) * 100);
    else if (student.xpTotal >= 250) levelProgress = Math.round(((student.xpTotal - 250) / 250) * 100);
    else if (student.xpTotal >= 100) levelProgress = Math.round(((student.xpTotal - 100) / 150) * 100);
    else levelProgress = Math.round((student.xpTotal / 100) * 100);

    return {
      xpEarned,
      coinsEarned,
      hasLeveledUp,
      newLevel,
      newTitle,
      badgeUnlocked,
      currentXp: student.xpTotal,
      currentCoins: student.eddvaCoins,
      levelProgress,
    };
  }
}
