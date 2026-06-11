import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Student } from '../../database/entities/student.entity';
import { Question } from '../../database/entities/question.entity';
import { Subject, Chapter } from '../../database/entities/subject.entity';
import { GameSession, QuizRushScore, Quest, QuestStage, StudentQuest, QuestReward, MathSprintScore, MemoryMatchScore, WordMasterScore } from '../../database/entities/game.entity';
import { NotificationService } from '../notification/notification.service';
import { GamificationService } from '../gamification/gamification.service';

@Injectable()
export class GamesService {
  constructor(
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Question, 'coaching')
    private readonly questionRepo: Repository<Question>,
    @InjectRepository(Subject, 'coaching')
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Chapter, 'coaching')
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(GameSession, 'coaching')
    private readonly sessionRepo: Repository<GameSession>,
    @InjectRepository(QuizRushScore, 'coaching')
    private readonly scoreRepo: Repository<QuizRushScore>,
    @InjectRepository(Quest, 'coaching')
    private readonly questRepo: Repository<Quest>,
    @InjectRepository(QuestStage, 'coaching')
    private readonly questStageRepo: Repository<QuestStage>,
    @InjectRepository(StudentQuest, 'coaching')
    private readonly studentQuestRepo: Repository<StudentQuest>,
    @InjectRepository(QuestReward, 'coaching')
    private readonly questRewardRepo: Repository<QuestReward>,
    @InjectRepository(MathSprintScore, 'coaching')
    private readonly mathScoreRepo: Repository<MathSprintScore>,
    @InjectRepository(MemoryMatchScore, 'coaching')
    private readonly memoryScoreRepo: Repository<MemoryMatchScore>,
    @InjectRepository(WordMasterScore, 'coaching')
    private readonly wordScoreRepo: Repository<WordMasterScore>,
    @InjectDataSource('coaching')
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
    private readonly gamificationService: GamificationService,
  ) {}

  /**
   * Helper to compute level and title based on XP
   */
  calculateLevel(xpTotal: number) {
    const level = Math.max(1, Math.floor(xpTotal / 1000) + 1);
    let title = 'Beginner';
    if (level >= 50) title = 'Legend';
    else if (level >= 30) title = 'Champion';
    else if (level >= 20) title = 'Expert';
    else if (level >= 10) title = 'Scholar';
    else if (level >= 5) title = 'Learner';
    return { level, title };
  }

  async getOrCreateStudent(userId: string, tenantId: string) {
    const effectiveTenantId = tenantId || '73a505c3-23eb-4166-b019-8c9bc154a284';
    let student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) {
      student = this.studentRepo.create({
        userId,
        tenantId: effectiveTenantId,
      });
      await this.studentRepo.save(student);
    }
    return student;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ─── QUIZ RUSH ─────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────

  async startQuizRush(
    subjectId: string,
    chapterId: string,
    difficulty: string,
    userId: string,
    tenantId: string,
  ) {
    const student = await this.getOrCreateStudent(userId, tenantId);

    const effectiveTenantId = tenantId || '73a505c3-23eb-4166-b019-8c9bc154a284';

    let questions: Question[] = [];
    const whereClause: any = { tenantId: effectiveTenantId, isActive: true };
    if (subjectId && subjectId !== 'any') whereClause.subjectId = subjectId;
    if (chapterId && chapterId !== 'any') whereClause.chapterId = chapterId;
    if (difficulty && difficulty !== 'any') whereClause.difficulty = difficulty;

    questions = await this.questionRepo.find({
      where: whereClause,
      relations: ['options'],
    });

    if (questions.length < 5 && difficulty && difficulty !== 'any') {
      const fallbackWhere = { ...whereClause };
      delete fallbackWhere.difficulty;
      questions = await this.questionRepo.find({
        where: fallbackWhere,
        relations: ['options'],
      });
    }

    if (questions.length < 5 && chapterId && chapterId !== 'any') {
      const fallbackWhere: any = { tenantId: effectiveTenantId, isActive: true };
      if (subjectId && subjectId !== 'any') fallbackWhere.subjectId = subjectId;
      questions = await this.questionRepo.find({
        where: fallbackWhere,
        relations: ['options'],
      });
    }

    if (questions.length < 5 && subjectId && subjectId !== 'any') {
      // Ultimate fallback: any global questions
      questions = await this.questionRepo.find({
        where: { tenantId: effectiveTenantId, isActive: true },
        relations: ['options'],
      });
    }

    if (questions.length < 5) {
      questions = await this.questionRepo.find({
        where: { tenantId, isActive: true },
        relations: ['options'],
      });
    }

    if (questions.length < 5) {
      throw new BadRequestException(
        'Not enough questions in the Question Bank to start Quiz Rush. Please add at least 5 questions.'
      );
    }

    const shuffledQuestions = this.shuffleArray(questions).slice(0, 5);
    const questionsPayload = shuffledQuestions.map((q) => {
      const shuffledOptions = this.shuffleArray(q.options).map((o) => ({
        id: o.id,
        optionLabel: o.optionLabel,
        content: o.content,
        contentImageUrl: o.contentImageUrl,
        isCorrect: o.isCorrect,
      }));
      return {
        id: q.id,
        content: q.content,
        contentImageUrl: q.contentImageUrl,
        type: q.type,
        difficulty: q.difficulty,
        options: shuffledOptions,
      };
    });

    const session = this.sessionRepo.create({
      tenantId,
      studentId: student.id,
      gameType: 'quiz_rush',
      status: 'active',
      xpEarned: 0,
      coinsEarned: 0,
      metadata: {
        questionsData: shuffledQuestions,
        questionIds: shuffledQuestions.map((q) => q.id),
      },
    });

    const savedSession = await this.sessionRepo.save(session);

    return {
      sessionId: savedSession.id,
      questions: questionsPayload,
    };
  }

  async submitQuizRush(
    sessionId: string,
    answers: Array<{ questionId: string; selectedOptionId: string; timeTakenSeconds: number }>,
    userId: string,
    tenantId: string,
  ) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, studentId: student.id, gameType: 'quiz_rush' },
    });
    if (!session) throw new NotFoundException('Game session not found');
    if (session.status === 'completed') {
      throw new BadRequestException('Session has already been submitted');
    }

    const questionsData: Question[] = session.metadata.questionsData;
    const questionMap = new Map(questionsData.map((q) => [q.id, q]));

    let correctAnswersCount = 0;
    let totalXpEarned = 0;
    let totalCoinsEarned = 0;
    let currentStreak = 0;
    let maxStreak = 0;
    let speedBonusCount = 0;
    let totalQuestionsCount = questionsData.length;
    let timeTakenSeconds = 0;

    const gradedAnswers = [];

    for (const answer of answers) {
      const question = questionMap.get(answer.questionId);
      if (!question) continue;

      timeTakenSeconds += answer.timeTakenSeconds;
      const correctOption = question.options.find((o) => o.isCorrect);
      const isCorrect = correctOption && correctOption.id === answer.selectedOptionId;

      let xpAwarded = 0;
      let coinsAwarded = 0;
      let isSpeedBonus = false;

      if (isCorrect) {
        correctAnswersCount++;
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
        xpAwarded += 10;
        coinsAwarded += 1;

        if (answer.timeTakenSeconds <= 5) {
          xpAwarded += 5;
          isSpeedBonus = true;
          speedBonusCount++;
        }
      } else {
        currentStreak = 0;
      }

      totalXpEarned += xpAwarded;
      totalCoinsEarned += coinsAwarded;

      gradedAnswers.push({
        questionId: answer.questionId,
        selectedOptionId: answer.selectedOptionId,
        correctOptionId: correctOption?.id || null,
        isCorrect,
        isSpeedBonus,
        timeTakenSeconds: answer.timeTakenSeconds,
        xpEarned: xpAwarded,
        coinsEarned: coinsAwarded,
      });
    }

    let isPerfectScore = false;
    if (correctAnswersCount === totalQuestionsCount && totalQuestionsCount > 0) {
      isPerfectScore = true;
      totalXpEarned += 50;
      totalCoinsEarned += 5;
    }

    const badgesToUnlock = isPerfectScore ? ['Quiz Master'] : [];
    const badgeDescriptions = isPerfectScore ? { 'Quiz Master': 'Congratulations! You unlocked the Quiz Master badge for achieving a perfect score in Quiz Rush!' } : {};

    const gamificationResult = await this.gamificationService.awardRewards({
      userId,
      tenantId,
      gameType: 'quiz_rush',
      xpEarned: totalXpEarned,
      coinsEarned: totalCoinsEarned,
      score: totalXpEarned,
      metadata: { sessionId, isPerfectScore },
      badgesToUnlock,
      badgeDescriptions,
    });

    session.status = 'completed';
    session.xpEarned = totalXpEarned;
    session.coinsEarned = totalCoinsEarned;
    session.metadata = {
      ...session.metadata,
      gradedAnswers,
      correctAnswersCount,
      totalQuestionsCount,
      isPerfectScore,
      maxStreak,
      speedBonusCount,
    };
    await this.sessionRepo.save(session);

    const quizScore = this.scoreRepo.create({
      gameSessionId: session.id,
      studentId: student.id,
      totalQuestions: totalQuestionsCount,
      correctAnswers: correctAnswersCount,
      score: totalXpEarned,
      maxStreak,
      timeTakenSeconds,
    });
    await this.scoreRepo.save(quizScore);

    return {
      sessionId: session.id,
      totalQuestions: totalQuestionsCount,
      correctAnswers: correctAnswersCount,
      xpEarned: totalXpEarned,
      coinsEarned: totalCoinsEarned,
      isPerfectScore,
      maxStreak,
      speedBonusCount,
      timeTakenSeconds,
      hasLeveledUp: gamificationResult.hasLeveledUp,
      newLevel: gamificationResult.newLevel,
      newTitle: gamificationResult.newTitle,
      badgeUnlocked: gamificationResult.badgeUnlocked,
      currentXp: gamificationResult.currentXp,
      currentCoins: gamificationResult.currentCoins,
      levelProgress: gamificationResult.levelProgress,
    };
  }

  async getQuizRushLeaderboard(tenantId: string) {
    const scores = await this.scoreRepo.find({
      relations: ['student', 'student.user'],
      order: { score: 'DESC', timeTakenSeconds: 'ASC' },
      take: 20,
    });

    const filteredScores = scores.filter((s) => s.student && s.student.tenantId === tenantId);

    return filteredScores.map((s, index) => ({
      rank: index + 1,
      studentId: s.studentId,
      name: s.student.user?.fullName || 'Anonymous Student',
      score: s.score,
      correctAnswers: s.correctAnswers,
      totalQuestions: s.totalQuestions,
      maxStreak: s.maxStreak,
      timeTakenSeconds: s.timeTakenSeconds,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ─── TREASURE HUNT ADVENTURE ───────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────

  async seedDefaultQuests(tenantId: string) {
    const defaultQuests = [
      {
        name: 'Curse of the Shadow Forest',
        description: 'Explore the forest checkpoint-by-checkpoint, solving NCERT challenges to unlock the ancient treasure chest.',
        mapType: 'forest',
        difficulty: 'medium',
        class: 'any',
        stages: [
          { name: 'Village Gates Edge', stageOrder: 1, questionCount: 3, xpReward: 30, coinsReward: 5 },
          { name: 'Darkwood Paths', stageOrder: 2, questionCount: 3, xpReward: 30, coinsReward: 5 },
          { name: 'Forgotten Ridge Mountain', stageOrder: 3, questionCount: 3, xpReward: 30, coinsReward: 5 },
          { name: 'Ancient Temple Entry', stageOrder: 4, questionCount: 3, xpReward: 30, coinsReward: 5 },
          { name: 'Treasure Cave Depths', stageOrder: 5, questionCount: 3, xpReward: 100, coinsReward: 25, badgeReward: 'Treasure Hunter' }
        ]
      },
      {
        name: 'Sanctum of the Sun King',
        description: 'Brave the scorching heat and solve difficult equations to lift the locks off the Sun King Vault.',
        mapType: 'temple',
        difficulty: 'hard',
        class: 'any',
        stages: [
          { name: 'Desert Oasis Post', stageOrder: 1, questionCount: 3, xpReward: 40, coinsReward: 8 },
          { name: 'Windstorm Canyon', stageOrder: 2, questionCount: 3, xpReward: 40, coinsReward: 8 },
          { name: 'Rocky Cliff Climbing', stageOrder: 3, questionCount: 3, xpReward: 40, coinsReward: 8 },
          { name: 'Outer Pillars Ruins', stageOrder: 4, questionCount: 3, xpReward: 40, coinsReward: 8 },
          { name: 'Golden Vault Room', stageOrder: 5, questionCount: 5, xpReward: 150, coinsReward: 40, badgeReward: 'Treasure Hunter' }
        ]
      }
    ];

    for (const dq of defaultQuests) {
      const q = this.questRepo.create({
        tenantId,
        name: dq.name,
        description: dq.description,
        mapType: dq.mapType,
        difficulty: dq.difficulty,
        class: dq.class
      });
      const savedQ = await this.questRepo.save(q);

      const stages = dq.stages.map((ds) => this.questStageRepo.create({
        questId: savedQ.id,
        name: ds.name,
        stageOrder: ds.stageOrder,
        questionCount: ds.questionCount,
        xpReward: ds.xpReward,
        coinsReward: ds.coinsReward,
        badgeReward: ds.badgeReward
      }));
      await this.questStageRepo.save(stages);
    }
  }

  async getTreasureMaps(userId: string, tenantId: string) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    let quests = await this.questRepo.find({
      where: { tenantId },
      relations: ['stages'],
      order: { createdAt: 'ASC' }
    });

    if (quests.length === 0) {
      await this.seedDefaultQuests(tenantId);
      quests = await this.questRepo.find({
        where: { tenantId },
        relations: ['stages'],
        order: { createdAt: 'ASC' }
      });
    }

    const mapResults = [];
    for (const q of quests) {
      let progress = await this.studentQuestRepo.findOne({
        where: { studentId: student.id, questId: q.id }
      });

      if (!progress) {
        progress = await this.studentQuestRepo.save(this.studentQuestRepo.create({
          studentId: student.id,
          questId: q.id,
          currentStageOrder: 1,
          status: 'active'
        }));
      }

      // Sort stages by order
      q.stages.sort((a, b) => a.stageOrder - b.stageOrder);

      mapResults.push({
        quest: {
          id: q.id,
          name: q.name,
          description: q.description,
          mapType: q.mapType,
          difficulty: q.difficulty,
          stages: q.stages.map(s => ({
            id: s.id,
            name: s.name,
            stageOrder: s.stageOrder,
            xpReward: s.xpReward,
            coinsReward: s.coinsReward,
          }))
        },
        progress: {
          currentStageOrder: progress.currentStageOrder,
          status: progress.status,
          completedAt: progress.completedAt,
        }
      });
    }

    return mapResults;
  }

  async getTreasureChallenge(questId: string, userId: string, tenantId: string) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    const quest = await this.questRepo.findOne({
      where: { id: questId, tenantId },
      relations: ['stages']
    });
    if (!quest) throw new NotFoundException('Quest not found');

    let progress = await this.studentQuestRepo.findOne({
      where: { studentId: student.id, questId }
    });
    if (!progress) {
      progress = await this.studentQuestRepo.save(this.studentQuestRepo.create({
        studentId: student.id,
        questId,
        currentStageOrder: 1,
        status: 'active'
      }));
    }

    if (progress.status === 'completed') {
      throw new BadRequestException('Quest has already been completed!');
    }

    const currentStage = quest.stages.find((s) => s.stageOrder === progress.currentStageOrder);
    if (!currentStage) throw new NotFoundException('Quest stage not found');

    // Fetch random active questions from Question Bank
    const filter: any = { tenantId, isActive: true };
    if (quest.subjectId) filter.subjectId = quest.subjectId;
    if (quest.chapterId) filter.chapterId = quest.chapterId;
    if (quest.difficulty) filter.difficulty = quest.difficulty;

    let questions = await this.questionRepo.find({
      where: filter,
      relations: ['options']
    });

    // Fallbacks if not enough questions
    if (questions.length < currentStage.questionCount) {
      delete filter.difficulty;
      questions = await this.questionRepo.find({
        where: filter,
        relations: ['options']
      });
    }

    if (questions.length < currentStage.questionCount) {
      questions = await this.questionRepo.find({
        where: { tenantId, isActive: true },
        relations: ['options']
      });
    }

    if (questions.length < currentStage.questionCount) {
      throw new BadRequestException('Not enough questions in the Question Bank to build the challenge.');
    }

    const shuffledQuestions = this.shuffleArray(questions).slice(0, currentStage.questionCount);
    const questionsPayload = shuffledQuestions.map((q) => {
      const shuffledOptions = this.shuffleArray(q.options).map((o) => ({
        id: o.id,
        optionLabel: o.optionLabel,
        content: o.content,
        contentImageUrl: o.contentImageUrl,
        isCorrect: o.isCorrect
      }));
      return {
        id: q.id,
        content: q.content,
        contentImageUrl: q.contentImageUrl,
        type: q.type,
        options: shuffledOptions,
      };
    });

    // Save temporary session in metadata
    progress.currentStageOrder = currentStage.stageOrder;
    // Store question correct options for grading
    await this.studentQuestRepo.save(progress);

    // Save temporary session
    const gameSession = await this.sessionRepo.save(this.sessionRepo.create({
      tenantId,
      studentId: student.id,
      gameType: 'treasure_hunt',
      status: 'active',
      metadata: {
        questId,
        stageOrder: currentStage.stageOrder,
        questionsData: shuffledQuestions
      }
    }));

    return {
      questId,
      sessionId: gameSession.id,
      stageId: currentStage.id,
      stageName: currentStage.name,
      stageOrder: currentStage.stageOrder,
      questions: questionsPayload,
    };
  }

  async completeTreasureStage(
    questId: string,
    answers: Array<{ questionId: string; selectedOptionId: string }>,
    userId: string,
    tenantId: string,
  ) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    const progress = await this.studentQuestRepo.findOne({
      where: { studentId: student.id, questId }
    });
    if (!progress) throw new NotFoundException('Active quest progress not found.');
    if (progress.status === 'completed') {
      throw new BadRequestException('Quest already completed.');
    }

    const quest = await this.questRepo.findOne({
      where: { id: questId, tenantId },
      relations: ['stages']
    });
    const currentStage = quest.stages.find((s) => s.stageOrder === progress.currentStageOrder);
    if (!currentStage) throw new NotFoundException('Current quest stage not found');

    // Retrieve last active game session for grading
    const gameSession = await this.sessionRepo.findOne({
      where: {
        studentId: student.id,
        status: 'active',
        gameType: 'treasure_hunt'
      },
      order: { createdAt: 'DESC' }
    });
    if (!gameSession || gameSession.metadata.questId !== questId || gameSession.metadata.stageOrder !== currentStage.stageOrder) {
      throw new BadRequestException('Game session matching quest stage not found.');
    }

    const questionsData: Question[] = gameSession.metadata.questionsData;
    const questionMap = new Map(questionsData.map((q) => [q.id, q]));

    let correctCount = 0;
    const totalCount = questionsData.length;

    for (const answer of answers) {
      const q = questionMap.get(answer.questionId);
      if (!q) continue;
      const correctOption = q.options.find((o) => o.isCorrect);
      if (correctOption && correctOption.id === answer.selectedOptionId) {
        correctCount++;
      }
    }

    // Pass criteria: Solve at least 2/3 (or >= 60%) of the questions correctly
    const passed = totalCount > 0 ? (correctCount / totalCount) >= 0.6 : true;

    let xpEarned = 0;
    let coinsEarned = 0;
    let badgeUnlocked = null;
    let questCompleted = false;

    let gamificationResult = null;

    if (passed) {
      xpEarned = currentStage.xpReward;
      coinsEarned = currentStage.coinsReward;

      // Advance checkpoint
      progress.currentStageOrder += 1;
      let shouldUnlockBadge = false;

      if (progress.currentStageOrder > 5) {
        progress.status = 'completed';
        progress.completedAt = new Date();
        questCompleted = true;
        shouldUnlockBadge = true;

        // Store Quest Reward
        await this.questRewardRepo.save(this.questRewardRepo.create({
          studentId: student.id,
          rewardType: 'badge',
          value: 'Treasure Hunter',
          isClaimed: true,
          claimedAt: new Date()
        }));
      }

      const badgesToUnlock = shouldUnlockBadge ? ['Treasure Hunter'] : [];
      const badgeDescriptions = shouldUnlockBadge ? { 'Treasure Hunter': 'Congratulations! You unlocked the Treasure Hunter badge for completing a Treasure Hunt adventure!' } : {};

      gamificationResult = await this.gamificationService.awardRewards({
        userId,
        tenantId,
        gameType: 'treasure_hunt',
        xpEarned,
        coinsEarned,
        score: correctCount,
        metadata: { questId, stageOrder: currentStage.stageOrder, passed },
        badgesToUnlock,
        badgeDescriptions,
      });

      badgeUnlocked = gamificationResult.badgeUnlocked;

      await this.studentQuestRepo.save(progress);

      // Complete session
      gameSession.status = 'completed';
      gameSession.xpEarned = xpEarned;
      gameSession.coinsEarned = coinsEarned;
      await this.sessionRepo.save(gameSession);
    } else {
      // Failed - Session abandoned
      gameSession.status = 'abandoned';
      await this.sessionRepo.save(gameSession);
    }

    const finalLevelData = this.gamificationService.calculateLevel(student.xpTotal);

    return {
      passed,
      currentStageOrder: progress.currentStageOrder,
      status: progress.status,
      xpEarned,
      coinsEarned,
      questCompleted,
      badgeUnlocked,
      currentXp: gamificationResult?.currentXp ?? student.xpTotal,
      currentCoins: gamificationResult?.currentCoins ?? student.eddvaCoins,
      level: gamificationResult?.newLevel ?? finalLevelData.level,
      levelTitle: gamificationResult?.newTitle ?? finalLevelData.title,
      levelProgress: gamificationResult?.levelProgress ?? 0,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ─── MATH SPRINT ───────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────

  async startMathSprint(difficulty: string, userId: string, tenantId: string) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    const questions = this.generateMathQuestions(difficulty);

    const session = this.sessionRepo.create({
      tenantId,
      studentId: student.id,
      gameType: 'math_sprint',
      status: 'active',
      xpEarned: 0,
      coinsEarned: 0,
      metadata: {
        difficulty,
        questionsData: questions,
        questionIds: questions.map((q) => q.id),
      },
    });

    const savedSession = await this.sessionRepo.save(session);

    return {
      sessionId: savedSession.id,
      questions: questions.map((q) => ({
        id: q.id,
        content: q.content,
        displayType: q.displayType,
        options: q.options.map((o) => ({
          id: o.id,
          content: o.content,
          isCorrect: o.isCorrect
        }))
      }))
    };
  }

  async submitMathSprint(
    sessionId: string,
    answers: Array<{ questionId: string; selectedOptionId: string }>,
    userId: string,
    tenantId: string,
  ) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, studentId: student.id, gameType: 'math_sprint' },
    });
    if (!session) throw new NotFoundException('Game session not found');
    if (session.status === 'completed') {
      throw new BadRequestException('Session has already been submitted');
    }

    const questionsData = session.metadata.questionsData;
    const questionMap = new Map<string, any>(questionsData.map((q: any) => [q.id, q]));

    let correctCount = 0;
    let questionsAttempted = answers.length;
    let currentStreak = 0;
    let maxStreak = 0;
    let xpEarned = 0;
    let coinsEarned = 0;

    const gradedAnswers = [];

    for (const answer of answers) {
      const question = questionMap.get(answer.questionId);
      if (!question) continue;

      const correctOption = question.options.find((o) => o.isCorrect);
      const isCorrect = correctOption && correctOption.id === answer.selectedOptionId;

      let xpAwarded = 0;
      let coinsAwarded = 0;
      let multiplier = 1;

      if (isCorrect) {
        correctCount++;
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);

        // Streak Multiplier
        if (currentStreak >= 5) {
          multiplier = 3;
        } else if (currentStreak >= 3) {
          multiplier = 2;
        }

        xpAwarded = 10 * multiplier;
        coinsAwarded = 1;
      } else {
        currentStreak = 0;
      }

      xpEarned += xpAwarded;
      coinsEarned += coinsAwarded;

      gradedAnswers.push({
        questionId: answer.questionId,
        selectedOptionId: answer.selectedOptionId,
        correctOptionId: correctOption?.id || null,
        isCorrect,
        xpEarned: xpAwarded,
        coinsEarned: coinsAwarded,
        multiplier
      });
    }

    // Streak Bonus Coins
    if (maxStreak >= 10) {
      coinsEarned += 5;
    }

    const shouldUnlockBadge = xpEarned >= 150;
    const badgesToUnlock = shouldUnlockBadge ? ['Math Speedster'] : [];
    const badgeDescriptions = shouldUnlockBadge ? { 'Math Speedster': 'Congratulations! You unlocked the Math Speedster badge for scoring 150+ in Math Sprint!' } : {};

    const gamificationResult = await this.gamificationService.awardRewards({
      userId,
      tenantId,
      gameType: 'math_sprint',
      xpEarned,
      coinsEarned,
      score: xpEarned,
      metadata: { sessionId, correctCount, questionsAttempted, maxStreak },
      badgesToUnlock,
      badgeDescriptions,
    });

    session.status = 'completed';
    session.xpEarned = xpEarned;
    session.coinsEarned = coinsEarned;
    session.metadata = {
      ...session.metadata,
      gradedAnswers,
      correctCount,
      questionsAttempted,
      maxStreak,
      xpEarned,
      coinsEarned,
    };
    await this.sessionRepo.save(session);

    // Save MathSprintScore rankings
    const mathScore = this.mathScoreRepo.create({
      gameSessionId: session.id,
      studentId: student.id,
      questionsAttempted,
      correctAnswers: correctCount,
      score: xpEarned,
      maxStreak,
      difficulty: session.metadata.difficulty
    });
    await this.mathScoreRepo.save(mathScore);

    return {
      sessionId: session.id,
      questionsAttempted,
      correctAnswers: correctCount,
      score: xpEarned,
      xpEarned,
      coinsEarned,
      maxStreak,
      hasLeveledUp: gamificationResult.hasLeveledUp,
      newLevel: gamificationResult.newLevel,
      newTitle: gamificationResult.newTitle,
      badgeUnlocked: gamificationResult.badgeUnlocked,
      currentXp: gamificationResult.currentXp,
      currentCoins: gamificationResult.currentCoins,
      levelProgress: gamificationResult.levelProgress,
    };
  }

  async getMathSprintLeaderboard(tenantId: string) {
    const scores = await this.mathScoreRepo.find({
      relations: ['student', 'student.user'],
      order: { score: 'DESC', correctAnswers: 'DESC' },
      take: 20,
    });

    const filteredScores = scores.filter((s) => s.student && s.student.tenantId === tenantId);

    return filteredScores.map((s, index) => ({
      rank: index + 1,
      studentId: s.studentId,
      name: s.student.user?.fullName || 'Anonymous Student',
      score: s.score,
      correctAnswers: s.correctAnswers,
      questionsAttempted: s.questionsAttempted,
      maxStreak: s.maxStreak,
      difficulty: s.difficulty,
    }));
  }

  private generateMathQuestions(difficulty: string): any[] {
    const list = [];
    for (let i = 0; i < 50; i++) {
      let equation = '';
      let correct = 0;
      let displayType = 'arithmetic'; // 'arithmetic' | 'algebra' | 'percentage'

      if (difficulty === 'easy') {
        const types = ['add', 'sub', 'mul', 'div'];
        const type = types[Math.floor(Math.random() * types.length)];
        if (type === 'add') {
          const a = Math.floor(Math.random() * 15) + 1;
          const b = Math.floor(Math.random() * 15) + 1;
          equation = `${a} + ${b}`;
          correct = a + b;
        } else if (type === 'sub') {
          const a = Math.floor(Math.random() * 15) + 6;
          const b = Math.floor(Math.random() * a);
          equation = `${a} - ${b}`;
          correct = a - b;
        } else if (type === 'mul') {
          const a = Math.floor(Math.random() * 9) + 2;
          const b = Math.floor(Math.random() * 9) + 1;
          equation = `${a} × ${b}`;
          correct = a * b;
        } else {
          const b = Math.floor(Math.random() * 8) + 2;
          const correctAns = Math.floor(Math.random() * 8) + 1;
          const a = b * correctAns;
          equation = `${a} ÷ ${b}`;
          correct = correctAns;
        }
      } else if (difficulty === 'medium') {
        const types = ['add', 'sub', 'mul', 'div', 'decimal'];
        const type = types[Math.floor(Math.random() * types.length)];
        if (type === 'add') {
          const a = Math.floor(Math.random() * 80) + 10;
          const b = Math.floor(Math.random() * 80) + 10;
          equation = `${a} + ${b}`;
          correct = a + b;
        } else if (type === 'sub') {
          const a = Math.floor(Math.random() * 80) + 30;
          const b = Math.floor(Math.random() * (a - 10)) + 5;
          equation = `${a} - ${b}`;
          correct = a - b;
        } else if (type === 'mul') {
          const a = Math.floor(Math.random() * 11) + 3;
          const b = Math.floor(Math.random() * 12) + 5;
          equation = `${a} × ${b}`;
          correct = a * b;
        } else if (type === 'div') {
          const b = Math.floor(Math.random() * 11) + 4;
          const correctAns = Math.floor(Math.random() * 12) + 3;
          const a = b * correctAns;
          equation = `${a} ÷ ${b}`;
          correct = correctAns;
        } else {
          // simple decimal addition / subtraction
          const isAdd = Math.random() > 0.5;
          const aVal = Math.floor(Math.random() * 9) + 1;
          const bVal = Math.floor(Math.random() * 9) + 1;
          const aDec = Math.random() > 0.5 ? 0.5 : 0.0;
          const bDec = Math.random() > 0.5 ? 0.5 : 0.0;
          const a = aVal + aDec;
          const b = bVal + bDec;
          if (isAdd) {
            equation = `${a.toFixed(1)} + ${b.toFixed(1)}`;
            correct = Number((a + b).toFixed(1));
          } else {
            const valA = Math.max(a, b);
            const valB = Math.min(a, b);
            equation = `${valA.toFixed(1)} - ${valB.toFixed(1)}`;
            correct = Number((valA - valB).toFixed(1));
          }
        }
      } else {
        // hard
        const types = ['add_sub', 'mul_div', 'algebra', 'percentage'];
        const type = types[Math.floor(Math.random() * types.length)];
        if (type === 'add_sub') {
          const a = Math.floor(Math.random() * 800) + 100;
          const b = Math.floor(Math.random() * 800) + 100;
          const isAdd = Math.random() > 0.5;
          if (isAdd) {
            equation = `${a} + ${b}`;
            correct = a + b;
          } else {
            const valA = Math.max(a, b);
            const valB = Math.min(a, b);
            equation = `${valA} - ${valB}`;
            correct = valA - valB;
          }
        } else if (type === 'mul_div') {
          const isMul = Math.random() > 0.5;
          if (isMul) {
            const a = Math.floor(Math.random() * 15) + 11;
            const b = Math.floor(Math.random() * 15) + 5;
            equation = `${a} × ${b}`;
            correct = a * b;
          } else {
            const b = Math.floor(Math.random() * 15) + 5;
            const correctAns = Math.floor(Math.random() * 15) + 5;
            const a = b * correctAns;
            equation = `${a} ÷ ${b}`;
            correct = correctAns;
          }
        } else if (type === 'algebra') {
          displayType = 'algebra';
          // solve for x: Ax + B = C
          const x = Math.floor(Math.random() * 8) + 2; // correct answer
          const A = Math.floor(Math.random() * 4) + 2; // e.g. 2, 3, 4, 5
          const isAdd = Math.random() > 0.5;
          if (isAdd) {
            const B = Math.floor(Math.random() * 15) + 1;
            const C = A * x + B;
            equation = `Solve for x:  ${A}x + ${B} = ${C}`;
            correct = x;
          } else {
            const B = Math.floor(Math.random() * 10) + 1;
            const C = A * x - B;
            equation = `Solve for x:  ${A}x - ${B} = ${C}`;
            correct = x;
          }
        } else {
          displayType = 'percentage';
          // X% of Y
          const p = [10, 20, 25, 30, 40, 50, 60, 75, 80, 90][Math.floor(Math.random() * 10)];
          const y = [40, 50, 60, 80, 100, 120, 150, 200, 300, 400][Math.floor(Math.random() * 10)];
          equation = `${p}% of ${y}`;
          correct = Math.round((p / 100) * y);
        }
      }

      // Generate options (correct + 3 unique distractors)
      const optionsSet = new Set<string>();
      let correctStr = '';
      if (difficulty === 'medium' && equation.includes('.')) {
        correctStr = correct.toFixed(1);
      } else {
        correctStr = String(Math.round(correct));
      }
      optionsSet.add(correctStr);

      let tries = 0;
      while (optionsSet.size < 4 && tries < 30) {
        tries++;
        let distractor = 0;
        const offset = (Math.floor(Math.random() * 5) + 1) * (Math.random() > 0.5 ? 1 : -1);
        if (difficulty === 'medium' && equation.includes('.')) {
          distractor = correct + offset * 0.5;
        } else {
          distractor = correct + offset;
        }

        // Avoid negative values for easy/medium
        if (distractor < 0 && difficulty !== 'hard') {
          distractor = Math.abs(distractor);
        }

        let distractorStr = '';
        if (difficulty === 'medium' && equation.includes('.')) {
          distractorStr = distractor.toFixed(1);
        } else {
          distractorStr = String(Math.round(distractor));
        }

        optionsSet.add(distractorStr);
      }

      // If set is still smaller than 4, force generate numbers
      let forceIdx = 1;
      while (optionsSet.size < 4) {
        optionsSet.add(String(Math.round(correct + forceIdx)));
        forceIdx++;
      }

      const options = Array.from(optionsSet).map((val, idx) => ({
        id: `opt_${idx}`,
        content: val,
        isCorrect: val === correctStr
      }));

      list.push({
        id: `q_${i}`,
        content: equation,
        displayType,
        options: this.shuffleArray(options)
      });
    }

    return list;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ─── MEMORY MATCH ─────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────

  async getMemoryMatchDecks() {
    const list = this.getDecksList();
    return list.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      difficulty: d.difficulty,
      pairsCount: d.cardPairs.length
    }));
  }

  async startMemoryMatch(deckId: string, userId: string, tenantId: string) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    const deck = this.getDecksList().find((d) => d.id === deckId);
    if (!deck) throw new NotFoundException('Memory deck not found');

    const cards = [];
    deck.cardPairs.forEach((pair, pairIdx) => {
      cards.push({
        id: `card_${pairIdx}_A`,
        content: pair.itemA,
        matchId: `pair_${pairIdx}`
      });
      cards.push({
        id: `card_${pairIdx}_B`,
        content: pair.itemB,
        matchId: `pair_${pairIdx}`
      });
    });

    const shuffledCards = this.shuffleArray(cards);

    const session = this.sessionRepo.create({
      tenantId,
      studentId: student.id,
      gameType: 'memory_match',
      status: 'active',
      xpEarned: 0,
      coinsEarned: 0,
      metadata: {
        deckId,
        deckName: deck.name,
        difficulty: deck.difficulty,
        minPossibleTurns: deck.cardPairs.length,
        originalCards: cards
      }
    });

    const savedSession = await this.sessionRepo.save(session);

    return {
      sessionId: savedSession.id,
      deckName: deck.name,
      difficulty: deck.difficulty,
      cards: shuffledCards
    };
  }

  async submitMemoryMatch(
    sessionId: string,
    turnsCount: number,
    mismatchesCount: number,
    userId: string,
    tenantId: string
  ) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, studentId: student.id, gameType: 'memory_match' }
    });
    if (!session) throw new NotFoundException('Game session not found');
    if (session.status === 'completed') {
      throw new BadRequestException('Session already completed');
    }

    const { difficulty, deckName, minPossibleTurns } = session.metadata;

    // Base XP: 10 XP per pair
    const baseXp = minPossibleTurns * 10;
    
    // Efficiency Bonus: e.g. 100 max, lose 6 points for every turn over min possible turns
    const extraTurns = Math.max(0, turnsCount - minPossibleTurns);
    const efficiencyBonus = Math.max(0, 100 - extraTurns * 6);
    
    const xpEarned = baseXp + efficiencyBonus;
    // Coins earned: 1 base coin per pair, plus bonus for efficiency
    let coinsEarned = minPossibleTurns;
    if (extraTurns <= 3) {
      coinsEarned += 5;
    } else if (extraTurns <= 6) {
      coinsEarned += 2;
    }

    const shouldUnlockBadge = difficulty === 'hard' && turnsCount <= 20;
    const badgesToUnlock = shouldUnlockBadge ? ['Mind Matcher'] : [];
    const badgeDescriptions = shouldUnlockBadge ? { 'Mind Matcher': 'Congratulations! You unlocked the Mind Matcher badge for completing a Hard Memory Match deck in under 20 turns!' } : {};

    const gamificationResult = await this.gamificationService.awardRewards({
      userId,
      tenantId,
      gameType: 'memory_match',
      xpEarned,
      coinsEarned,
      score: xpEarned,
      metadata: { sessionId, turnsCount, mismatchesCount, difficulty },
      badgesToUnlock,
      badgeDescriptions,
    });

    session.status = 'completed';
    session.xpEarned = xpEarned;
    session.coinsEarned = coinsEarned;
    session.metadata = {
      ...session.metadata,
      turnsCount,
      mismatchesCount,
      xpEarned,
      coinsEarned
    };
    await this.sessionRepo.save(session);

    // Save MemoryMatchScore ranking
    const memoryScore = this.memoryScoreRepo.create({
      gameSessionId: session.id,
      studentId: student.id,
      turnsCount,
      mismatchesCount,
      score: xpEarned,
      deckCategory: deckName,
      difficulty
    });
    await this.memoryScoreRepo.save(memoryScore);

    return {
      sessionId: session.id,
      turnsCount,
      mismatchesCount,
      score: xpEarned,
      xpEarned,
      coinsEarned,
      hasLeveledUp: gamificationResult.hasLeveledUp,
      newLevel: gamificationResult.newLevel,
      newTitle: gamificationResult.newTitle,
      badgeUnlocked: gamificationResult.badgeUnlocked,
      currentXp: gamificationResult.currentXp,
      currentCoins: gamificationResult.currentCoins,
      levelProgress: gamificationResult.levelProgress,
    };
  }

  async getMemoryMatchLeaderboard(tenantId: string) {
    const scores = await this.memoryScoreRepo.find({
      relations: ['student', 'student.user'],
      order: { score: 'DESC', turnsCount: 'ASC' },
      take: 20
    });

    const filteredScores = scores.filter((s) => s.student && s.student.tenantId === tenantId);

    return filteredScores.map((s, index) => ({
      rank: index + 1,
      studentId: s.studentId,
      name: s.student.user?.fullName || 'Anonymous Student',
      score: s.score,
      turnsCount: s.turnsCount,
      mismatchesCount: s.mismatchesCount,
      deckCategory: s.deckCategory,
      difficulty: s.difficulty
    }));
  }

  private getDecksList() {
    return [
      {
        id: 'space_easy',
        name: 'Space Exploration',
        description: 'Match solar system planets with their traits and positions!',
        difficulty: 'easy',
        cardPairs: [
          { itemA: 'Mercury', itemB: 'Closest planet to Sun' },
          { itemA: 'Venus', itemB: 'Hottest planet' },
          { itemA: 'Earth', itemB: 'Only known life planet' },
          { itemA: 'Mars', itemB: 'The Red Planet' },
          { itemA: 'Jupiter', itemB: 'Largest planet' },
          { itemA: 'Saturn', itemB: 'Has spectacular rings' }
        ]
      },
      {
        id: 'chemistry_medium',
        name: 'Chemistry Elements',
        description: 'Match common elements with their chemical periodic symbols!',
        difficulty: 'medium',
        cardPairs: [
          { itemA: 'Hydrogen', itemB: 'H' },
          { itemA: 'Helium', itemB: 'He' },
          { itemA: 'Carbon', itemB: 'C' },
          { itemA: 'Nitrogen', itemB: 'N' },
          { itemA: 'Oxygen', itemB: 'O' },
          { itemA: 'Sodium', itemB: 'Na' },
          { itemA: 'Iron', itemB: 'Fe' },
          { itemA: 'Gold', itemB: 'Au' }
        ]
      },
      {
        id: 'capitals_medium',
        name: 'World Capitals',
        description: 'Match countries with their political capital cities!',
        difficulty: 'medium',
        cardPairs: [
          { itemA: 'India', itemB: 'New Delhi' },
          { itemA: 'Japan', itemB: 'Tokyo' },
          { itemA: 'France', itemB: 'Paris' },
          { itemA: 'United Kingdom', itemB: 'London' },
          { itemA: 'United States', itemB: 'Washington D.C.' },
          { itemA: 'Australia', itemB: 'Canberra' },
          { itemA: 'Germany', itemB: 'Berlin' },
          { itemA: 'Brazil', itemB: 'Brasilia' }
        ]
      },
      {
        id: 'math_hard',
        name: 'Math Formulas',
        description: 'Match geometric shapes and algebra terms with their formulas!',
        difficulty: 'hard',
        cardPairs: [
          { itemA: 'Area of Circle', itemB: 'πr²' },
          { itemA: 'Circumference of Circle', itemB: '2πr' },
          { itemA: 'Area of Triangle', itemB: '½ × b × h' },
          { itemA: 'Volume of Sphere', itemB: '⁴/₃πr³' },
          { itemA: 'Pythagorean Theorem', itemB: 'a² + b² = c²' },
          { itemA: 'Quadratic Equation', itemB: 'x = (-b ± √(b²-4ac)) / 2a' },
          { itemA: 'Area of Rectangle', itemB: 'l × w' },
          { itemA: 'Volume of Cylinder', itemB: 'πr²h' }
        ]
      },
      {
        id: 'history_hard',
        name: 'Indian History Highlights',
        description: 'Match historic Indian achievements and movements with their years!',
        difficulty: 'hard',
        cardPairs: [
          { itemA: 'First Battle of Panipat', itemB: '1526' },
          { itemA: 'Battle of Plassey', itemB: '1757' },
          { itemA: 'Indian Rebellion / Sepoy Mutiny', itemB: '1857' },
          { itemA: 'Quit India Movement launched', itemB: '1942' },
          { itemA: 'India wins Independence', itemB: '1947' },
          { itemA: 'Indian Constitution enacted', itemB: '1950' },
          { itemA: 'First Indian space satellite launch (Aryabhata)', itemB: '1975' },
          { itemA: 'Kargil War', itemB: '1999' }
        ]
      }
    ];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ─── HELPER ────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────

  private shuffleArray<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ─── WORD MASTER ───────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────

  async getWordMasterDecks() {
    const list = this.getWordDecksList();
    return list.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      difficulty: d.difficulty,
      wordsCount: d.words.length
    }));
  }

  async startWordMaster(deckId: string, userId: string, tenantId: string) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    const deck = this.getWordDecksList().find((d) => d.id === deckId);
    if (!deck) throw new NotFoundException('Word deck not found');

    const wordsData = deck.words.map((item, index) => {
      const scrambled = this.scrambleWord(item.word);
      return {
        index,
        scrambled,
        hint: item.hint,
        length: item.word.length
      };
    });

    const session = this.sessionRepo.create({
      tenantId,
      studentId: student.id,
      gameType: 'word_master',
      status: 'active',
      xpEarned: 0,
      coinsEarned: 0,
      metadata: {
        deckId,
        deckName: deck.name,
        difficulty: deck.difficulty,
        originalWords: deck.words
      }
    });

    const savedSession = await this.sessionRepo.save(session);

    return {
      sessionId: savedSession.id,
      deckName: deck.name,
      difficulty: deck.difficulty,
      words: wordsData
    };
  }

  async submitWordMaster(
    sessionId: string,
    answers: Array<{ index: number; word: string }>,
    userId: string,
    tenantId: string
  ) {
    const student = await this.getOrCreateStudent(userId, tenantId);
    if (!student) throw new NotFoundException('Student profile not found');

    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, studentId: student.id, gameType: 'word_master' }
    });
    if (!session) throw new NotFoundException('Game session not found');
    if (session.status === 'completed') {
      throw new BadRequestException('Session already completed');
    }

    const { difficulty, deckName, originalWords } = session.metadata;

    let correctAnswers = 0;
    let currentStreak = 0;
    let maxStreak = 0;

    answers.forEach((ans) => {
      const original = originalWords[ans.index];
      if (original && ans.word.trim().toUpperCase() === original.word.toUpperCase()) {
        correctAnswers++;
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    });

    const wordsAttempted = originalWords.length;

    // Base XP: 15 XP per correct word
    let xpEarned = correctAnswers * 15;
    
    // Streak Bonus: e.g. +5 XP per unit of maxStreak
    xpEarned += maxStreak * 5;

    // Coins earned: 1 base coin per correct answer, plus +5 coins if 10/10 correct
    let coinsEarned = correctAnswers;
    if (correctAnswers === wordsAttempted) {
      coinsEarned += 5;
    }

    const shouldUnlockBadge = difficulty === 'hard' && correctAnswers === wordsAttempted;
    const badgesToUnlock = shouldUnlockBadge ? ['Vocab Wizard'] : [];
    const badgeDescriptions = shouldUnlockBadge ? { 'Vocab Wizard': 'Incredible! You unlocked the Vocab Wizard badge for completing a Hard Word Master deck with 100% accuracy!' } : {};

    const gamificationResult = await this.gamificationService.awardRewards({
      userId,
      tenantId,
      gameType: 'word_master',
      xpEarned,
      coinsEarned,
      score: xpEarned,
      metadata: { sessionId, correctAnswers, wordsAttempted },
      badgesToUnlock,
      badgeDescriptions,
    });

    session.status = 'completed';
    session.xpEarned = xpEarned;
    session.coinsEarned = coinsEarned;
    session.metadata = {
      ...session.metadata,
      answers,
      correctAnswers,
      wordsAttempted,
      xpEarned,
      coinsEarned
    };
    await this.sessionRepo.save(session);

    // Save WordMasterScore ranking
    const wordScore = this.wordScoreRepo.create({
      gameSessionId: session.id,
      studentId: student.id,
      wordsAttempted,
      correctAnswers,
      score: xpEarned,
      maxStreak,
      deckCategory: deckName,
      difficulty
    });
    await this.wordScoreRepo.save(wordScore);

    return {
      sessionId: session.id,
      wordsAttempted,
      correctAnswers,
      score: xpEarned,
      xpEarned,
      coinsEarned,
      maxStreak,
      hasLeveledUp: gamificationResult.hasLeveledUp,
      newLevel: gamificationResult.newLevel,
      newTitle: gamificationResult.newTitle,
      badgeUnlocked: gamificationResult.badgeUnlocked,
      currentXp: gamificationResult.currentXp,
      currentCoins: gamificationResult.currentCoins,
      levelProgress: gamificationResult.levelProgress,
    };
  }

  async getWordMasterLeaderboard(tenantId: string) {
    const scores = await this.wordScoreRepo.find({
      relations: ['student', 'student.user'],
      order: { score: 'DESC', correctAnswers: 'DESC' },
      take: 20
    });

    const filteredScores = scores.filter((s) => s.student && s.student.tenantId === tenantId);

    return filteredScores.map((s, index) => ({
      rank: index + 1,
      studentId: s.studentId,
      name: s.student.user?.fullName || 'Anonymous Student',
      score: s.score,
      wordsAttempted: s.wordsAttempted,
      correctAnswers: s.correctAnswers,
      maxStreak: s.maxStreak,
      deckCategory: s.deckCategory,
      difficulty: s.difficulty
    }));
  }

  private scrambleWord(word: string): string {
    const arr = word.split('');
    let scrambled = this.shuffleArray(arr).join('');
    let tries = 0;
    while (scrambled === word && tries < 5 && word.length > 2) {
      scrambled = this.shuffleArray(arr).join('');
      tries++;
    }
    return scrambled;
  }

  private getWordDecksList() {
    return [
      {
        id: 'science_easy',
        name: 'Science Explorers',
        description: 'Unscramble key concepts from Earth, Life, and Physical Sciences!',
        difficulty: 'easy',
        words: [
          { word: 'GRAVITY', hint: 'The force that pulls objects toward the center of a planet.' },
          { word: 'PHOTOSYNTHESIS', hint: 'Process by which green plants make food using sunlight.' },
          { word: 'CELL', hint: 'The basic structural and functional unit of all living organisms.' },
          { word: 'LIQUID', hint: 'State of matter with a definite volume but no definite shape.' },
          { word: 'ENERGY', hint: 'The ability to do work or cause change.' },
          { word: 'OXYGEN', hint: 'Gas that humans inhale to survive.' },
          { word: 'NUCLEUS', hint: 'The central core of an atom or a cell.' },
          { word: 'REACTION', hint: 'A process in which substances change into new substances.' },
          { word: 'MAGNET', hint: 'An object that attracts iron and produces a magnetic field.' },
          { word: 'EVAPORATION', hint: 'The process of a liquid turning into vapor.' }
        ]
      },
      {
        id: 'math_medium',
        name: 'Math Vocabulary',
        description: 'Unscramble basic geometry, algebra, and coordinate arithmetic terms!',
        difficulty: 'medium',
        words: [
          { word: 'EQUATION', hint: 'A mathematical statement showing that two expressions are equal.' },
          { word: 'FRACTION', hint: 'A numerical quantity that is not a whole number (e.g., 1/2).' },
          { word: 'RADIUS', hint: 'A straight line from the center to the circumference of a circle.' },
          { word: 'ALGEBRA', hint: 'Branch of mathematics using symbols and letters to represent numbers.' },
          { word: 'DECIMAL', hint: 'A fraction whose denominator is a power of ten, written with a dot.' },
          { word: 'TRIANGLE', hint: 'A polygon with three edges and three vertices.' },
          { word: 'DIVISION', hint: 'The operation of splitting a number into equal parts.' },
          { word: 'PERCENTAGE', hint: 'A rate, number, or amount in each hundred.' },
          { word: 'INTEGER', hint: 'A whole number that can be positive, negative, or zero.' },
          { word: 'SYMMETRY', hint: 'The quality of being made up of exactly similar parts facing each other.' }
        ]
      },
      {
        id: 'english_medium',
        name: 'Synonyms & Antonyms',
        description: 'Match and unscramble key synonym and antonym vocabulary!',
        difficulty: 'medium',
        words: [
          { word: 'BENEFICIAL', hint: 'Synonym for advantageous, helpful, or producing good results.' },
          { word: 'GENEROUS', hint: 'Synonym for charitable, showing readiness to give more.' },
          { word: 'HOSTILE', hint: 'Synonym for unfriendly, antagonistic, or combative.' },
          { word: 'GIGANTIC', hint: 'Synonym for huge, colossal, or of very great size.' },
          { word: 'ANCIENT', hint: 'Antonym for modern, belonging to the very distant past.' },
          { word: 'SCARCE', hint: 'Antonym for abundant, insufficient for the demand.' },
          { word: 'CAUTIOUS', hint: 'Synonym for careful, avoiding unnecessary risks.' },
          { word: 'AMBIGUOUS', hint: 'Synonym for unclear, open to more than one interpretation.' },
          { word: 'VALIANT', hint: 'Synonym for brave, courageous, or showing determination.' },
          { word: 'ABOLISH', hint: 'Synonym for cancel, put an end to, or formally destroy.' }
        ]
      },
      {
        id: 'social_hard',
        name: 'Civics & Landmarks',
        description: 'Unscramble vocabulary about empires, constitutions, and political concepts!',
        difficulty: 'hard',
        words: [
          { word: 'DEMOCRACY', hint: 'A system of government by the whole population through representatives.' },
          { word: 'DYNASTY', hint: 'A line of hereditary rulers of a country.' },
          { word: 'PARLIAMENT', hint: 'The supreme legislative body of a country.' },
          { word: 'CONSTITUTION', hint: 'A body of fundamental principles according to which a state is governed.' },
          { word: 'REVOLUTION', hint: 'A forcible overthrow of a government or social order.' },
          { word: 'FEDERATION', hint: 'A group of states with a central government but independence in internal affairs.' },
          { word: 'SOVEREIGNTY', hint: 'The authority of a state to govern itself or another state.' },
          { word: 'MONARCHY', hint: 'A form of government with a monarch at the head.' },
          { word: 'COLONIALISM', hint: 'The policy of acquiring full or partial political control over another country.' },
          { word: 'REPUBLIC', hint: 'A state in which supreme power is held by the people and their elected representatives.' }
        ]
      },
      {
        id: 'vocab_hard',
        name: 'Advanced Vocabulary',
        description: 'Tackle high-level NCERT English literature and advanced academic words!',
        difficulty: 'hard',
        words: [
          { word: 'EPHEMERAL', hint: 'Lasting for a very short time; transient.' },
          { word: 'MAGNANIMOUS', hint: 'Generous or forgiving, especially toward a rival or less powerful person.' },
          { word: 'OBSEQUIOUS', hint: 'Obedient or attentive to an excessive or servile degree.' },
          { word: 'BENEVOLENT', hint: 'Well-meaning and kindly.' },
          { word: 'ELOQUENT', hint: 'Fluent or persuasive in speaking or writing.' },
          { word: 'METICULOUS', hint: 'Showing great attention to detail; very careful and precise.' },
          { word: 'PRAGMATIC', hint: 'Dealing with things sensibly and realistically based on practical considerations.' },
          { word: 'REDUNDANT', hint: 'Not or no longer needed or useful; superfluous.' },
          { word: 'SCRUTINIZER', hint: 'Someone who examines or inspects something closely.' },
          { word: 'SOLITUDE', hint: 'The state or situation of being alone.' }
        ]
      }
    ];
  }
}

