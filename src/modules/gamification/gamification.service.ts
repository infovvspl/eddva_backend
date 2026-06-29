import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Repository, DataSource } from 'typeorm';
import { Cache } from 'cache-manager';
import { Student } from '../../database/entities/student.entity';
import { GamificationHistory } from '../../database/entities/gamification.entity';
import { NotificationService } from '../notification/notification.service';
import { recordStudentActivity } from '../../common/gamification-helper';

@Injectable()
export class GamificationService implements OnModuleInit {
  constructor(
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(GamificationHistory, 'coaching')
    private readonly historyRepo: Repository<GamificationHistory>,
    private readonly notificationService: NotificationService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    @InjectDataSource('school')
    private readonly schoolDs: DataSource,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureTablesExist();
    } catch (err) {
      console.error('Failed to ensure school gamification tables exist:', err.message);
    }
  }

  async ensureTablesExist() {
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS gamification_profiles (
        user_id VARCHAR(255) PRIMARY KEY,
        xp INTEGER NOT NULL DEFAULT 0,
        coins INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        badges JSONB NOT NULL DEFAULT '[]',
        current_streak INTEGER NOT NULL DEFAULT 0,
        longest_streak INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS gamification_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        game_type VARCHAR(100) NOT NULL,
        xp_earned INTEGER NOT NULL DEFAULT 0,
        coins_earned INTEGER NOT NULL DEFAULT 0,
        score DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS student_activity (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        activity_date DATE NOT NULL,
        activity_type VARCHAR(100) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_user_date_type UNIQUE (user_id, activity_date, activity_type)
      )
    `);
  }

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

    // Save to school database gamification tables
    try {
      // Fetch or insert profile
      const exist = await this.schoolDs.query(
        `SELECT user_id, current_streak, longest_streak FROM gamification_profiles WHERE user_id = $1`,
        [userId]
      );
      
      let currentStreak = 0;
      let longestStreak = 0;

      if (exist.length > 0) {
        currentStreak = Number(exist[0].current_streak || 0);
        longestStreak = Number(exist[0].longest_streak || 0);
      }

      if (score > 0) {
        if (currentStreak === 0) {
          currentStreak = 1;
          longestStreak = Math.max(longestStreak, currentStreak);
        }
      }

      if (exist.length === 0) {
        await this.schoolDs.query(
          `INSERT INTO gamification_profiles (user_id, xp, coins, level, badges, current_streak, longest_streak) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, xpEarned, coinsEarned, newLevel, JSON.stringify(unlockedBadges), currentStreak, longestStreak]
        );
      } else {
        await this.schoolDs.query(
          `UPDATE gamification_profiles 
           SET xp = xp + $1, coins = coins + $2, level = $3, badges = $4, current_streak = $5, longest_streak = $6, updated_at = NOW()
           WHERE user_id = $7`,
          [xpEarned, coinsEarned, newLevel, JSON.stringify(unlockedBadges), currentStreak, longestStreak, userId]
        );
      }

      // Save history to school database gamification_history
      await this.schoolDs.query(
        `INSERT INTO gamification_history (user_id, game_type, xp_earned, coins_earned, score)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, gameType, xpEarned, coinsEarned, score]
      );

      // Record student activity (this also recalculates and updates the streak in gamification_profiles)
      await recordStudentActivity(this.schoolDs, userId, 'game', this.cacheManager);
    } catch (err) {
      console.error('[School DB Gamification Update Error]:', err.message);
    }

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
