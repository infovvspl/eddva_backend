import { Injectable, Inject, OnModuleInit, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Repository, DataSource } from 'typeorm';
import { Cache } from 'cache-manager';
import { Student } from '../../database/entities/student.entity';
import { GamificationHistory } from '../../database/entities/gamification.entity';
import { NotificationService } from '../notification/notification.service';
import { recordStudentActivity } from '../../common/gamification-helper';
import { SEED_ACHIEVEMENTS } from './seed-achievements';

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
      console.error('[GamificationService] DB Init Warning:', err.message);
    }
  }

  async ensureTablesExist() {
    // 1. Gamification Profiles (Enhanced with lifetime XP, Reward INR balance, Memory/Learning/Focus Scores, Difficulty)
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS gamification_profiles (
        user_id VARCHAR(255) PRIMARY KEY,
        xp INTEGER NOT NULL DEFAULT 0,
        lifetime_xp INTEGER NOT NULL DEFAULT 0,
        coins INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        reward_balance_inr NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        memory_score INTEGER NOT NULL DEFAULT 75,
        learning_score INTEGER NOT NULL DEFAULT 80,
        focus_score INTEGER NOT NULL DEFAULT 85,
        current_difficulty VARCHAR(50) NOT NULL DEFAULT 'Intermediate',
        rank_tier VARCHAR(50) NOT NULL DEFAULT 'Gold',
        league_name VARCHAR(50) NOT NULL DEFAULT 'Gold League',
        badges JSONB NOT NULL DEFAULT '[]',
        current_streak INTEGER NOT NULL DEFAULT 0,
        longest_streak INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Gamification History / Logs
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS gamification_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        game_type VARCHAR(100) NOT NULL,
        xp_earned INTEGER NOT NULL DEFAULT 0,
        coins_earned INTEGER NOT NULL DEFAULT 0,
        score DOUBLE PRECISION NOT NULL DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Student Activity (for Streak Tracking)
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

    // 4. Reward Ledger Transactions
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS reward_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        amount_inr NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        xp_converted INTEGER NOT NULL DEFAULT 0,
        transaction_type VARCHAR(50) NOT NULL,
        source VARCHAR(100) NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Reward Redemptions (Payout Requests)
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS reward_redemptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        amount_inr NUMERIC(12, 2) NOT NULL,
        payout_method VARCHAR(50) NOT NULL DEFAULT 'DEMO_PAYMENT_RECEIVE',
        payout_details JSONB DEFAULT '{}',
        status VARCHAR(50) NOT NULL DEFAULT 'APPROVED',
        demo_payout_id VARCHAR(100),
        admin_notes TEXT,
        processed_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Adaptive Difficulty Logs
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS adaptive_difficulty_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        game_type VARCHAR(100) NOT NULL,
        accuracy NUMERIC(5, 2) DEFAULT 0,
        avg_speed_sec NUMERIC(6, 2) DEFAULT 0,
        hint_count INTEGER DEFAULT 0,
        previous_difficulty VARCHAR(50) NOT NULL,
        new_difficulty VARCHAR(50) NOT NULL,
        reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. AI Memorization Items (Flashcards, Mnemonics, Memory Stories, Mind Maps, Formula Sheets)
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS ai_memorization_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        subject_name VARCHAR(100) DEFAULT 'General',
        topic_name VARCHAR(100) DEFAULT 'General',
        concept_name VARCHAR(255) NOT NULL,
        item_type VARCHAR(50) NOT NULL,
        content_json JSONB NOT NULL DEFAULT '{}',
        weak_score INTEGER DEFAULT 60,
        repetitions INTEGER DEFAULT 0,
        ease_factor NUMERIC(4, 2) DEFAULT 2.5,
        next_review_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 8. Daily Missions
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS daily_missions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        mission_date DATE NOT NULL DEFAULT CURRENT_DATE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        activity_type VARCHAR(100) NOT NULL,
        target_count INTEGER NOT NULL DEFAULT 1,
        current_count INTEGER NOT NULL DEFAULT 0,
        reward_xp INTEGER NOT NULL DEFAULT 50,
        reward_coins INTEGER NOT NULL DEFAULT 10,
        badge_id VARCHAR(100),
        is_claimed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 9. Weekly Challenges
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS weekly_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        target_activity VARCHAR(100) NOT NULL,
        target_count INTEGER NOT NULL DEFAULT 5,
        reward_xp INTEGER NOT NULL DEFAULT 500,
        reward_coins INTEGER NOT NULL DEFAULT 100,
        badge_id VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 10. Achievements Master
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS achievements_master (
        id VARCHAR(100) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        icon VARCHAR(100) NOT NULL,
        tier VARCHAR(50) NOT NULL,
        criteria_type VARCHAR(100) NOT NULL,
        criteria_target INTEGER NOT NULL DEFAULT 1,
        reward_xp INTEGER DEFAULT 50,
        reward_coins INTEGER DEFAULT 10
      )
    `);

    // 11. User Achievements
    await this.schoolDs.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        achievement_id VARCHAR(100) NOT NULL,
        unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        progress INTEGER DEFAULT 100,
        CONSTRAINT unique_user_achievement UNIQUE (user_id, achievement_id)
      )
    `);

    // Seed 100 achievements if achievements_master table is empty
    const checkCount = await this.schoolDs.query(`SELECT COUNT(*)::int as count FROM achievements_master`);
    if (checkCount[0]?.count === 0) {
      console.log('[GamificationService] Seeding 100 default achievements...');
      for (const ach of SEED_ACHIEVEMENTS) {
        await this.schoolDs.query(
          `INSERT INTO achievements_master (id, title, category, description, icon, tier, criteria_type, criteria_target, reward_xp, reward_coins)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [ach.id, ach.title, ach.category, ach.description, ach.icon, ach.tier, ach.criteria_type, ach.criteria_target, ach.reward_xp, ach.reward_coins]
        );
      }
    }
  }

  /**
   * Helper to compute level and title based on XP
   */
  calculateLevel(xpTotal: number) {
    let level = 1;
    let title = 'Beginner';

    if (xpTotal >= 5000) { level = 10; title = 'Legendary Overlord'; }
    else if (xpTotal >= 3500) { level = 9; title = 'Grandmaster'; }
    else if (xpTotal >= 2500) { level = 8; title = 'Master Scholar'; }
    else if (xpTotal >= 1800) { level = 7; title = 'Academic Virtuoso'; }
    else if (xpTotal >= 1200) { level = 6; title = 'Elite Scholar'; }
    else if (xpTotal >= 800) { level = 5; title = 'Champion'; }
    else if (xpTotal >= 500) { level = 4; title = 'Expert'; }
    else if (xpTotal >= 250) { level = 3; title = 'Scholar'; }
    else if (xpTotal >= 100) { level = 2; title = 'Learner'; }

    return { level, title };
  }

  /**
   * Primary XP & Reward Awarding Engine
   * 100 XP = ₹1 reward wallet conversion logic included
   */
  async awardRewards(params: {
    userId: string;
    tenantId?: string;
    gameType: string;
    xpEarned: number;
    coinsEarned: number;
    score: number;
    accuracy?: number;
    avgSpeedSec?: number;
    metadata?: any;
    badgesToUnlock?: string[];
    badgeDescriptions?: Record<string, string>;
  }) {
    const { userId, tenantId, gameType, xpEarned, coinsEarned, score, accuracy = 85, avgSpeedSec = 10, metadata, badgesToUnlock } = params;

    let student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) {
      student = this.studentRepo.create({
        userId,
        tenantId: tenantId || '73a505c3-23eb-4166-b019-8c9bc154a284',
      });
      student = await this.studentRepo.save(student);
    }

    student.xpTotal = (student.xpTotal || 0) + xpEarned;
    student.eddvaCoins = (student.eddvaCoins || 0) + coinsEarned;

    const { level: newLevel, title: newTitle } = this.calculateLevel(student.xpTotal);
    const hasLeveledUp = newLevel > (student.currentLevel || 1);
    student.currentLevel = newLevel;

    const unlockedBadges = student.unlockedBadges || [];
    let badgeUnlocked = null;

    if (badgesToUnlock && badgesToUnlock.length > 0) {
      for (const badge of badgesToUnlock) {
        if (!unlockedBadges.includes(badge)) {
          unlockedBadges.push(badge);
          student.unlockedBadges = unlockedBadges;
          badgeUnlocked = badge;
        }
      }
    }

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

    // 100 XP = ₹1 calculation (Reward Wallet increment)
    const inrEarned = Number((xpEarned / 100).toFixed(2));

    try {
      const exist = await this.schoolDs.query(
        `SELECT user_id, current_streak, longest_streak, current_difficulty, reward_balance_inr FROM gamification_profiles WHERE user_id = $1`,
        [userId]
      );

      let currentStreak = 0;
      let longestStreak = 0;
      let currentDifficulty = 'Intermediate';

      if (exist.length > 0) {
        currentStreak = Number(exist[0].current_streak || 0);
        longestStreak = Number(exist[0].longest_streak || 0);
        currentDifficulty = exist[0].current_difficulty || 'Intermediate';
      }

      if (score > 0) {
        if (currentStreak === 0) {
          currentStreak = 1;
          longestStreak = Math.max(longestStreak, currentStreak);
        }
      }

      // Calculate AI Adaptive Difficulty adjustment
      const newDifficulty = this.calculateNextDifficulty(currentDifficulty, accuracy, avgSpeedSec);

      if (exist.length === 0) {
        await this.schoolDs.query(
          `INSERT INTO gamification_profiles (user_id, xp, lifetime_xp, coins, level, reward_balance_inr, current_difficulty, badges, current_streak, longest_streak) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [userId, xpEarned, xpEarned, coinsEarned, newLevel, inrEarned, newDifficulty, JSON.stringify(unlockedBadges), currentStreak, longestStreak]
        );
      } else {
        await this.schoolDs.query(
          `UPDATE gamification_profiles 
           SET xp = xp + $1, lifetime_xp = lifetime_xp + $1, coins = coins + $2, level = $3, reward_balance_inr = reward_balance_inr + $4, current_difficulty = $5, badges = $6, current_streak = $7, longest_streak = $8, updated_at = NOW()
           WHERE user_id = $9`,
          [xpEarned, coinsEarned, newLevel, inrEarned, newDifficulty, JSON.stringify(unlockedBadges), currentStreak, longestStreak, userId]
        );
      }

      // Log Reward Transaction Ledger (100 XP = ₹1)
      if (inrEarned > 0) {
        await this.schoolDs.query(
          `INSERT INTO reward_transactions (user_id, amount_inr, xp_converted, transaction_type, source, metadata)
           VALUES ($1, $2, $3, 'EARNED', $4, $5)`,
          [userId, inrEarned, xpEarned, gameType, JSON.stringify({ score, coinsEarned })]
        );
      }

      // Log Adaptive Difficulty if changed
      if (newDifficulty !== currentDifficulty) {
        await this.schoolDs.query(
          `INSERT INTO adaptive_difficulty_logs (user_id, game_type, accuracy, avg_speed_sec, previous_difficulty, new_difficulty, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, gameType, accuracy, avgSpeedSec, currentDifficulty, newDifficulty, `AI evaluated accuracy ${accuracy}% and speed ${avgSpeedSec}s`]
        );
      }

      // Record Activity
      await recordStudentActivity(this.schoolDs, userId, 'game', this.cacheManager);

      // Evaluate Achievements unlock
      await this.evaluateAchievements(userId, gameType, accuracy);

      // Update Daily Missions progress
      await this.updateDailyMissionsProgress(userId, gameType);

    } catch (err) {
      console.error('[GamificationService Update Error]:', err.message);
    }

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
      inrEarned,
      hasLeveledUp,
      newLevel,
      newTitle,
      badgeUnlocked,
      currentXp: student.xpTotal,
      currentCoins: student.eddvaCoins,
      levelProgress,
    };
  }

  /**
   * AI Adaptive Difficulty Algorithm
   * Beginner -> Easy -> Intermediate -> Advanced -> Expert -> Master
   */
  calculateNextDifficulty(current: string, accuracy: number, speedSec: number): string {
    const levels = ['Beginner', 'Easy', 'Intermediate', 'Advanced', 'Expert', 'Master'];
    let idx = levels.indexOf(current);
    if (idx === -1) idx = 2; // Default to Intermediate

    if (accuracy >= 90 && speedSec <= 12) {
      idx = Math.min(levels.length - 1, idx + 1);
    } else if (accuracy < 50) {
      idx = Math.max(0, idx - 1);
    }
    return levels[idx];
  }

  /**
   * Fetch Gamification Profile with Full Stats & Reward Wallet (100 XP = ₹1)
   */
  async getStudentGamificationProfile(userId: string) {
    const rows = await this.schoolDs.query(
      `SELECT user_id, xp, lifetime_xp, coins, level, reward_balance_inr, memory_score, learning_score, focus_score, current_difficulty, rank_tier, league_name, badges, current_streak, longest_streak FROM gamification_profiles WHERE user_id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      return {
        userId,
        xp: 0,
        lifetimeXp: 0,
        coins: 0,
        level: 1,
        rewardBalanceInr: 0.0,
        memoryScore: 75,
        learningScore: 80,
        focusScore: 85,
        currentDifficulty: 'Intermediate',
        rankTier: 'Gold',
        leagueName: 'Gold League',
        badges: [],
        currentStreak: 0,
        longestStreak: 0,
        nextLevelXp: 100,
        estimatedTimeToNextLevel: '45 mins of study',
      };
    }

    const p = rows[0];
    const xp = Number(p.xp || 0);
    const { level, title } = this.calculateLevel(xp);

    // Calculate level progress
    let prevLevelXp = 0;
    let nextLevelXp = 100;
    if (xp >= 5000) { prevLevelXp = 3500; nextLevelXp = 5000; }
    else if (xp >= 3500) { prevLevelXp = 2500; nextLevelXp = 3500; }
    else if (xp >= 2500) { prevLevelXp = 1800; nextLevelXp = 2500; }
    else if (xp >= 1800) { prevLevelXp = 1200; nextLevelXp = 1800; }
    else if (xp >= 1200) { prevLevelXp = 800; nextLevelXp = 1200; }
    else if (xp >= 800) { prevLevelXp = 500; nextLevelXp = 800; }
    else if (xp >= 500) { prevLevelXp = 250; nextLevelXp = 500; }
    else if (xp >= 250) { prevLevelXp = 100; nextLevelXp = 250; }
    else if (xp >= 100) { prevLevelXp = 0; nextLevelXp = 100; }

    const levelProgressPercent = Math.min(100, Math.round(((xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100));

    return {
      userId: p.user_id,
      xp,
      lifetimeXp: Number(p.lifetime_xp || xp),
      coins: Number(p.coins || 0),
      level,
      levelTitle: title,
      levelProgressPercent,
      rewardBalanceInr: Number(p.reward_balance_inr || (xp / 100).toFixed(2)),
      memoryScore: Number(p.memory_score || 75),
      learningScore: Number(p.learning_score || 80),
      focusScore: Number(p.focus_score || 85),
      currentDifficulty: p.current_difficulty || 'Intermediate',
      rankTier: p.rank_tier || 'Gold',
      leagueName: p.league_name || 'Gold League',
      badges: Array.isArray(p.badges) ? p.badges : (typeof p.badges === 'string' ? JSON.parse(p.badges) : []),
      currentStreak: Number(p.current_streak || 0),
      longestStreak: Number(p.longest_streak || 0),
      nextLevelXp,
      estimatedTimeToNextLevel: `${Math.ceil((nextLevelXp - xp) / 20)} mins of active study`,
    };
  }

  /**
   * Request Wallet Reward Redemption (Demo Payment Receive workflow)
   */
  async requestRewardRedemption(userId: string, amountInr: number, payoutMethod: string = 'DEMO_PAYMENT_RECEIVE', payoutDetails: any = {}) {
    if (amountInr <= 0) {
      throw new BadRequestException('Redemption amount must be greater than ₹0');
    }

    const profile = await this.getStudentGamificationProfile(userId);
    if (profile.rewardBalanceInr < amountInr) {
      throw new BadRequestException(`Insufficient reward wallet balance. You have ₹${profile.rewardBalanceInr}`);
    }

    const demoPayoutId = `DEMO_PAY_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Create redemption entry in APPROVED/PAID state for Demo Mode
    const redemptionResult = await this.schoolDs.query(
      `INSERT INTO reward_redemptions (user_id, amount_inr, payout_method, payout_details, status, demo_payout_id, admin_notes)
       VALUES ($1, $2, $3, $4, 'APPROVED', $5, 'Demo Payment Received Automatically')
       RETURNING *`,
      [userId, amountInr, payoutMethod, JSON.stringify(payoutDetails), demoPayoutId]
    );

    // Deduct reward balance and record transaction
    await this.schoolDs.query(
      `UPDATE gamification_profiles SET reward_balance_inr = reward_balance_inr - $1 WHERE user_id = $2`,
      [amountInr, userId]
    );

    await this.schoolDs.query(
      `INSERT INTO reward_transactions (user_id, amount_inr, xp_converted, transaction_type, source, metadata)
       VALUES ($1, $2, $3, 'REDEEMED', 'DEMO_PAYMENT_RECEIVE', $4)`,
      [userId, amountInr, amountInr * 100, JSON.stringify({ demoPayoutId, payoutDetails })]
    );

    return {
      message: 'Demo payout received successfully!',
      redemption: redemptionResult[0],
      demoPayoutId,
      remainingBalanceInr: profile.rewardBalanceInr - amountInr,
    };
  }

  /**
   * Fetch Transaction & Redemption History
   */
  async getRewardHistory(userId: string) {
    const transactions = await this.schoolDs.query(
      `SELECT * FROM reward_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    const redemptions = await this.schoolDs.query(
      `SELECT * FROM reward_redemptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    return { transactions, redemptions };
  }

  /**
   * AI Memorization Engine: Fetch or Generate Flashcards, Mnemonics & Mind Maps
   */
  async getAiMemorizationItems(userId: string) {
    let items = await this.schoolDs.query(
      `SELECT * FROM ai_memorization_items WHERE user_id = $1 ORDER BY next_review_at ASC`,
      [userId]
    );

    if (items.length === 0) {
      // Seed initial AI generated items for student
      const initialItems = [
        {
          subject: 'Science',
          topic: 'Physics - Optics',
          concept: 'Snells Law of Refraction',
          type: 'FLASHCARD',
          content: { front: 'What is Snells Law?', back: 'n1 * sin(theta1) = n2 * sin(theta2). Refraction formula between mediums.' },
          weakScore: 65,
        },
        {
          subject: 'Chemistry',
          topic: 'Periodic Table',
          concept: 'Reactivity of Alkali Metals',
          type: 'MNEMONIC',
          content: { mnemonic: 'LiNa Ki Ruby Cse Friyad', meaning: 'Lithium, Sodium, Potassium, Rubidium, Cesium, Francium' },
          weakScore: 50,
        },
        {
          subject: 'Mathematics',
          topic: 'Calculus',
          concept: 'Derivative of Trigonometric Functions',
          type: 'FORMULA',
          content: { title: 'Trig Derivatives', formulas: ['d/dx(sin x) = cos x', 'd/dx(cos x) = -sin x', 'd/dx(tan x) = sec^2 x'] },
          weakScore: 40,
        },
        {
          subject: 'Science',
          topic: 'Biology',
          concept: 'Photosynthesis Light vs Dark Reactions',
          type: 'STORY',
          content: { story: 'In the Sunny Leaf Kingdom, Solar Knights (Photons) energize Water Crystals to release Oxygen, while Chloroplast Alchemists synthesize Glucose for the castle.' },
          weakScore: 70,
        },
      ];

      for (const item of initialItems) {
        await this.schoolDs.query(
          `INSERT INTO ai_memorization_items (user_id, subject_name, topic_name, concept_name, item_type, content_json, weak_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, item.subject, item.topic, item.concept, item.type, JSON.stringify(item.content), item.weakScore]
        );
      }

      items = await this.schoolDs.query(`SELECT * FROM ai_memorization_items WHERE user_id = $1`, [userId]);
    }

    return items;
  }

  /**
   * Daily Missions Fetcher & Generator
   */
  async getDailyMissions(userId: string) {
    const today = new Date().toISOString().split('T')[0];
    let missions = await this.schoolDs.query(
      `SELECT * FROM daily_missions WHERE user_id = $1 AND mission_date = $2`,
      [userId, today]
    );

    if (missions.length === 0) {
      const defaultMissions = [
        { title: 'Watch 1 Learning Video', desc: 'Watch any concept lesson video today', type: 'VIDEO', target: 1, xp: 50, coins: 10, badge: 'Video Explorer' },
        { title: 'Complete 1 Quiz Rush Game', desc: 'Test your speed in Quiz Rush', type: 'QUIZ', target: 1, xp: 75, coins: 15, badge: 'Speedy Brain' },
        { title: 'Win 1 Battle Arena Duel', desc: 'Challenge a peer in real-time battle', type: 'BATTLE', target: 1, xp: 100, coins: 20, badge: 'Arena Warrior' },
        { title: 'Revise 5 AI Flashcards', desc: 'Strengthen weak memory concepts', type: 'AI_REVISION', target: 5, xp: 60, coins: 10, badge: 'Memory Master' },
      ];

      for (const m of defaultMissions) {
        await this.schoolDs.query(
          `INSERT INTO daily_missions (user_id, mission_date, title, description, activity_type, target_count, current_count, reward_xp, reward_coins, badge_id)
           VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9)`,
          [userId, today, m.title, m.desc, m.type, m.target, m.xp, m.coins, m.badge]
        );
      }

      missions = await this.schoolDs.query(
        `SELECT * FROM daily_missions WHERE user_id = $1 AND mission_date = $2`,
        [userId, today]
      );
    }

    return missions;
  }

  /**
   * Claim Daily Mission Reward
   */
  async claimMissionReward(userId: string, missionId: string) {
    const mission = await this.schoolDs.query(
      `SELECT * FROM daily_missions WHERE id = $1 AND user_id = $2`,
      [missionId, userId]
    );

    if (mission.length === 0) throw new NotFoundException('Mission not found');
    const m = mission[0];
    if (m.is_claimed) throw new BadRequestException('Mission reward already claimed');
    if (m.current_count < m.target_count) throw new BadRequestException('Mission objectives not yet completed');

    await this.schoolDs.query(
      `UPDATE daily_missions SET is_claimed = TRUE WHERE id = $1`,
      [missionId]
    );

    return this.awardRewards({
      userId,
      gameType: `MISSION_CLAIM_${m.activity_type}`,
      xpEarned: Number(m.reward_xp || 50),
      coinsEarned: Number(m.reward_coins || 10),
      score: 100,
      badgesToUnlock: m.badge_id ? [m.badge_id] : [],
    });
  }

  /**
   * Update Daily Mission progress on activity
   */
  private async updateDailyMissionsProgress(userId: string, gameType: string) {
    const today = new Date().toISOString().split('T')[0];
    await this.schoolDs.query(
      `UPDATE daily_missions 
       SET current_count = LEAST(target_count, current_count + 1)
       WHERE user_id = $1 AND mission_date = $2 AND is_claimed = FALSE`,
      [userId, today]
    );
  }

  /**
   * Evaluate and unlock achievements based on user actions
   */
  private async evaluateAchievements(userId: string, activityType: string, scoreAccuracy: number) {
    // Unlock first step achievements
    const checkUserAch = await this.schoolDs.query(
      `SELECT achievement_id FROM user_achievements WHERE user_id = $1`,
      [userId]
    );
    const unlockedIds = new Set(checkUserAch.map((a: any) => a.achievement_id));

    // Sample trigger rules
    const toUnlock: string[] = [];
    if (!unlockedIds.has('game_1')) toUnlock.push('game_1');
    if (!unlockedIds.has('learn_1')) toUnlock.push('learn_1');
    if (scoreAccuracy >= 100 && !unlockedIds.has('learn_8')) toUnlock.push('learn_8');

    for (const achId of toUnlock) {
      await this.schoolDs.query(
        `INSERT INTO user_achievements (user_id, achievement_id, progress) VALUES ($1, $2, 100) ON CONFLICT DO NOTHING`,
        [userId, achId]
      );
    }
  }

  /**
   * Fetch Achievements (All 100+ master + student unlocked status)
   */
  async getAchievements(userId: string) {
    const master = await this.schoolDs.query(`SELECT * FROM achievements_master ORDER BY category, tier`);
    const unlocked = await this.schoolDs.query(`SELECT achievement_id, unlocked_at, progress FROM user_achievements WHERE user_id = $1`, [userId]);
    const unlockedMap = new Map(unlocked.map((u: any) => [u.achievement_id, u]));

    return master.map((a: any) => ({
      ...a,
      isUnlocked: unlockedMap.has(a.id),
      unlockedAt: (unlockedMap.get(a.id) as any)?.unlocked_at || null,
      progress: unlockedMap.has(a.id) ? 100 : 0,
    }));
  }

  /**
   * Multi-Dimensional Leaderboards Fetcher
   */
  async getMultiLeaderboard(scope: string = 'GLOBAL') {
    const rows = await this.schoolDs.query(
      `SELECT user_id, xp, coins, level, current_streak, current_difficulty, rank_tier, league_name 
       FROM gamification_profiles 
       ORDER BY xp DESC 
       LIMIT 50`
    );

    return rows.map((r: any, idx: number) => ({
      rank: idx + 1,
      userId: r.user_id,
      name: r.user_name || r.name || `Student ${String(r.user_id || '0000').slice(-4)}`,
      xp: Number(r.xp || 0),
      coins: Number(r.coins || 0),
      level: Number(r.level || 1),
      streak: Number(r.current_streak || 0),
      tier: r.rank_tier || 'Gold',
      league: r.league_name || 'Gold League',
    }));
  }
}
