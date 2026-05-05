import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import {
  Battle,
  BattleParticipant,
  BattleAnswer,
  StudentElo,
  BattleStatus,
  BattleMode,
  EloTier,
} from '../../database/entities/battle.entity';
import { Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { Question, DifficultyLevel } from '../../database/entities/question.entity';
import { Student, ExamTarget } from '../../database/entities/student.entity';
import { Topic } from '../../database/entities/subject.entity';
import { Lecture } from '../../database/entities/learning.entity';
import { AiBridgeService } from '../ai-bridge/ai-bridge.service';

interface AiBattleQuestion {
  id: string;
  text: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  meta?: any;
}

@Injectable()
export class BattleService {
  private readonly logger = new Logger(BattleService.name);

  constructor(
    @InjectRepository(Battle)
    private readonly battleRepo: Repository<Battle>,
    @InjectRepository(BattleParticipant)
    private readonly participantRepo: Repository<BattleParticipant>,
    @InjectRepository(BattleAnswer)
    private readonly answerRepo: Repository<BattleAnswer>,
    @InjectRepository(StudentElo)
    private readonly eloRepo: Repository<StudentElo>,
    @InjectRepository(Question)
    private readonly questionRepo: Repository<Question>,
    private readonly aiBridgeService: AiBridgeService,
    private readonly dataSource: DataSource,
  ) {
    // Force clear topic-level cache on every restart/save to ensure fresh tracking
    this.topicQuestionsCache.clear();
    this.logger.log('Battle Arena Topic Cache Cleared');
  }

  // Per-battle cache (cleared on battle end)
  private readonly aiBattleQuestionsByBattleId = new Map<string, AiBattleQuestion[]>();

  // Topic-level cache: reused across battles with the same topic+exam; TTL 2 hours
  private readonly topicQuestionsCache = new Map<
    string,
    { questions: AiBattleQuestion[]; cachedAt: number }
  >();
  private readonly TOPIC_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

  // ─── Helper: get or create StudentElo ─────────────────────────────────────

  private async getOrCreateElo(studentId: string, tenantId: string): Promise<StudentElo> {
    let elo = await this.eloRepo.findOne({ where: { studentId } });
    if (!elo) {
      elo = this.eloRepo.create({ studentId, eloRating: 1000, tier: EloTier.IRON, battleXp: 0 });
      elo = await this.eloRepo.save(elo);
    }
    return elo;
  }

  // ─── Helper: get student by userId ────────────────────────────────────────

  private async getStudent(userId: string): Promise<Student> {
    const student = await this.dataSource
      .getRepository(Student)
      .findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');
    return student;
  }

  async getStudentTenantByStudentId(studentId: string): Promise<string | null> {
    const enrollment = await this.dataSource.getRepository(Enrollment).findOne({
      where: { studentId, status: EnrollmentStatus.ACTIVE },
      relations: ['batch'],
      order: { enrolledAt: 'DESC' },
    });
    if (enrollment?.batch?.tenantId) return enrollment.batch.tenantId;

    const student = await this.dataSource.getRepository(Student).findOne({
      where: { id: studentId },
      select: ['id', 'tenantId'],
    });
    return student?.tenantId ?? null;
  }

  // ─── Helper: format room response ─────────────────────────────────────────

  private async formatRoom(battle: Battle, tenantId: string) {
    const participants = await this.participantRepo.find({
      where: { battleId: battle.id },
      relations: ['student', 'student.user'],
    });

    // Map backend status to frontend-expected values
    const statusMap: Record<string, string> = {
      [BattleStatus.WAITING]:   'waiting',
      [BattleStatus.ACTIVE]:    'in_progress',
      [BattleStatus.FINISHED]:  'completed',
      [BattleStatus.ABANDONED]: 'completed',
    };

    return {
      battleId: battle.id,
      roomCode: battle.roomCode,
      status: statusMap[battle.status] ?? battle.status,
      mode: battle.mode,
      topicId: battle.topicId,
      totalRounds: battle.totalRounds,
      secondsPerRound: battle.secondsPerRound,
      participantCount: participants.length,
      maxParticipants: battle.maxParticipants,
      participants: participants.map(p => ({
        studentId: p.studentId,
        name: (p.student as any)?.user?.fullName ?? (p.student as any)?.fullName ?? 'Player',
        avatarUrl: (p.student as any)?.user?.avatarUrl ?? null,
        roundsWon: p.roundsWon,
        isBot: p.isBot,
      })),
    };
  }

  // ─── Create Battle ────────────────────────────────────────────────────────

  // ─── Mark Battle Active ───────────────────────────────────────────────────

  async startBattle(battleId: string) {
    await this.battleRepo.update(battleId, {
      status: BattleStatus.ACTIVE,
      startedAt: new Date(),
    });
  }

  // ─── Create Battle (with auto-matchmaking queue) ──────────────────────────

  async createBattleRoom(
    userId: string,
    tenantId: string,
    mode = BattleMode.QUICK_DUEL,
    topicId?: string,
    topicName?: string,
    requestedDifficulty?: 'easy' | 'medium' | 'hard',
    batchId?: string,
    subjectId?: string,
    chapterId?: string,
  ) {
    const student = await this.getStudent(userId);
    const effectiveDifficulty: 'easy' | 'medium' | 'hard' = requestedDifficulty ?? 'medium';

    // ── Auto-matchmaking: for quick_duel, topic_battle, and daily mode
    //    find an existing WAITING room (with <maxParticipants) and join it
    if (
      mode === BattleMode.QUICK_DUEL ||
      mode === BattleMode.TOPIC_BATTLE ||
      mode === BattleMode.DAILY
    ) {
      const qb = this.battleRepo
        .createQueryBuilder('b')
        .where('b.tenantId = :tenantId AND b.mode = :mode AND b.status = :status', {
          tenantId, mode, status: BattleStatus.WAITING,
        });

      // For topic battles, match on the same topic
      if (mode === BattleMode.TOPIC_BATTLE && topicId) {
        qb.andWhere('b.topicId = :topicId', { topicId });
      }
      // Same AI question set: only match players who asked for the same difficulty
      qb.andWhere("COALESCE(b.replay_data->>'difficulty', 'medium') = :effDiff", {
        effDiff: effectiveDifficulty,
      });

      qb.orderBy('b.createdAt', 'ASC');
      const existingBattle = await qb.getOne();

      if (existingBattle) {
        const alreadyIn = await this.participantRepo.findOne({
          where: { battleId: existingBattle.id, studentId: student.id },
        });
        if (!alreadyIn) {
          const count = await this.participantRepo.count({ where: { battleId: existingBattle.id } });
          if (count < existingBattle.maxParticipants) {
            const elo = await this.getOrCreateElo(student.id, tenantId);
            await this.participantRepo.save(
              this.participantRepo.create({
                battleId: existingBattle.id,
                studentId: student.id,
                eloBefore: elo.eloRating,
              }),
            );
            return this.formatRoom(existingBattle, tenantId);
          }
        }
      }
    }

    const roomCode = this.generateRoomCode();

    const qCount = mode === BattleMode.QUICK_DUEL ? 5 : 10;
    const secs   = mode === BattleMode.QUICK_DUEL ? 30 : 45;

    const battle = await this.battleRepo.save(
      this.battleRepo.create({
        tenantId,
        topicId: topicId ?? null,
        roomCode,
        mode,
        status: BattleStatus.WAITING,
        maxParticipants: 2,
        totalRounds: qCount,
        secondsPerRound: secs,
      }),
    );

    const createQuestions = async () => {
      try {
        const isFullSyllabus = !!batchId && !subjectId && !chapterId && !topicId;
        const aiQuestions = await this.buildAiBattleQuestions(
          tenantId,
          qCount,
          topicId ?? null,
          student.examTarget ?? undefined,
          topicName,
          effectiveDifficulty,
          batchId,
          subjectId,
          chapterId,
          isFullSyllabus,
        );
        this.aiBattleQuestionsByBattleId.set(battle.id, aiQuestions);
        battle.totalRounds = aiQuestions.length; // Update total rounds to match actual generated questions
        battle.replayData = {
          ...(battle.replayData ?? {}),
          difficulty: effectiveDifficulty,
          aiQuestions,
        };
        await this.battleRepo.save(battle);
      } catch (e) {
        this.logger.error(`AI battle question generation failed for battle ${battle.id}: ${e.message}`);
      }
    };

    if (mode === BattleMode.CHALLENGE_FRIEND) {
      // Return room immediately, generate in background
      void createQuestions();
      return this.formatRoom(battle, tenantId);
    }

    // Otherwise (Quick/Daily/Topic), wait for questions to ensure matchmaking is ready
    await createQuestions();
    return this.formatRoom(battle, tenantId);

    // Add creator as participant
    const elo = await this.getOrCreateElo(student.id, tenantId);
    await this.participantRepo.save(
      this.participantRepo.create({
        battleId: battle.id,
        studentId: student.id,
        eloBefore: elo.eloRating,
      }),
    );

    return this.formatRoom(battle, tenantId);
  }

  // ─── Create private room for challenge flow (gateway) ─────────────────────

  async createPrivateChallengeRoom(
    challengerStudentId: string, 
    targetStudentId: string, 
    tenantId: string, 
    batchId?: string, 
    batchName?: string, 
    difficulty?: 'easy'|'medium'|'hard', 
    topicId?: string, 
    topicName?: string,
    subjectId?: string,
    subjectName?: string,
    chapterId?: string,
    chapterName?: string,
  ) {
    if (!challengerStudentId || !targetStudentId) {
      throw new BadRequestException('Both challenger and target are required');
    }
    if (challengerStudentId === targetStudentId) {
      throw new BadRequestException('Cannot challenge yourself');
    }

    const roomCode = this.generateRoomCode();
    const qCount = 10;
    const secs = 45;

    const battle = await this.battleRepo.save(
      this.battleRepo.create({
        tenantId,
        topicId: topicId ?? null,
        roomCode,
        mode: BattleMode.TOPIC_BATTLE,
        status: BattleStatus.WAITING,
        maxParticipants: 2,
        totalRounds: qCount,
        secondsPerRound: secs,
      }),
    );

    const challengerStudent = await this.dataSource
      .getRepository(Student)
      .findOne({ where: { id: challengerStudentId } });
    const examTarget = challengerStudent?.examTarget ?? undefined;

    const effDiff = difficulty ?? 'medium';
    const createQuestions = async () => {
      try {
        const isFullSyllabus = !!batchId && !topicId && !subjectId && !chapterId;
        const aiQuestions = await this.buildAiBattleQuestions(
          tenantId,
          qCount,
          topicId ?? null,
          examTarget,
          topicName ?? batchName,
          effDiff,
          batchId,
          subjectId,
          chapterId,
          isFullSyllabus,
        );
        this.aiBattleQuestionsByBattleId.set(battle.id, aiQuestions);
        battle.totalRounds = aiQuestions.length; // Update total rounds to match actual generated questions
        battle.replayData = {
          ...(battle.replayData ?? {}),
          difficulty: effDiff,
          aiQuestions,
        };
        await this.battleRepo.save(battle);
      } catch (e) {
        this.logger.error(`AI private battle question generation failed for battle ${battle.id}: ${e.message}`);
      }
    };

    // Generate in background so we can return the room immediately
    void createQuestions();

    const [challengerElo, targetElo] = await Promise.all([
      this.getOrCreateElo(challengerStudentId, tenantId),
      this.getOrCreateElo(targetStudentId, tenantId),
    ]);

    await this.participantRepo.save([
      this.participantRepo.create({
        battleId: battle.id,
        studentId: challengerStudentId,
        eloBefore: challengerElo.eloRating,
      }),
      this.participantRepo.create({
        battleId: battle.id,
        studentId: targetStudentId,
        eloBefore: targetElo.eloRating,
      }),
    ]);

    return this.formatRoom(battle, tenantId);
  }

  // ─── Join Battle (HTTP) ───────────────────────────────────────────────────

  async joinBattleByCode(roomCode: string, userId: string, tenantId: string) {
    const student = await this.getStudent(userId);
    // roomCode is globally unique — don't filter by tenantId to avoid mismatches
    const battle = await this.battleRepo.findOne({ where: { roomCode } });
    if (!battle) throw new NotFoundException('Battle room not found');
    if (battle.status === BattleStatus.FINISHED || battle.status === BattleStatus.ABANDONED) {
      throw new BadRequestException('Battle already finished');
    }

    const existing = await this.participantRepo.findOne({
      where: { battleId: battle.id, studentId: student.id },
    });

    if (!existing) {
      const count = await this.participantRepo.count({ where: { battleId: battle.id } });
      if (count >= battle.maxParticipants) throw new BadRequestException('Battle room is full');

      const elo = await this.getOrCreateElo(student.id, tenantId);
      await this.participantRepo.save(
        this.participantRepo.create({
          battleId: battle.id,
          studentId: student.id,
          eloBefore: elo.eloRating,
        }),
      );
    }

    return this.formatRoom(battle, tenantId);
  }

  // ─── Join Room (Gateway-internal — uses studentId directly) ───────────────

  async joinRoomGateway(roomCode: string, studentId: string) {
    const battle = await this.battleRepo.findOne({ where: { roomCode } });
    if (!battle) throw new NotFoundException('Battle room not found');
    if (battle.status === BattleStatus.FINISHED || battle.status === BattleStatus.ABANDONED) {
      throw new BadRequestException('Battle already finished');
    }

    const existing = await this.participantRepo.findOne({
      where: { battleId: battle.id, studentId },
    });

    if (!existing) {
      const count = await this.participantRepo.count({ where: { battleId: battle.id } });
      if (count >= battle.maxParticipants) throw new BadRequestException('Battle room is full');

      const elo = await this.eloRepo.findOne({ where: { studentId } });
      await this.participantRepo.save(
        this.participantRepo.create({
          battleId: battle.id,
          studentId,
          eloBefore: elo?.eloRating ?? 1000,
        }),
      );
    }

    return battle;
  }

  // ─── Get Room ─────────────────────────────────────────────────────────────

  async getRoom(battleId: string, tenantId: string) {
    const battle = await this.battleRepo.findOne({ where: { id: battleId, tenantId } });
    if (!battle) throw new NotFoundException('Battle not found');
    return this.formatRoom(battle, tenantId);
  }

  // ─── Cancel Battle ────────────────────────────────────────────────────────

  async cancelBattle(battleId: string, userId: string, tenantId: string) {
    const student = await this.getStudent(userId);
    const battle = await this.battleRepo.findOne({ where: { id: battleId, tenantId } });
    if (!battle) throw new NotFoundException('Battle not found');

    await this.battleRepo.update(battle.id, { status: BattleStatus.ABANDONED });
    return { success: true };
  }

  async abandonBattleByRoomCode(roomCode: string) {
    const battle = await this.battleRepo.findOne({ where: { roomCode } });
    if (!battle) return null;
    if (battle.status === BattleStatus.FINISHED || battle.status === BattleStatus.ABANDONED) {
      return battle;
    }
    await this.battleRepo.update(battle.id, {
      status: BattleStatus.ABANDONED,
      endedAt: new Date(),
    });
    return battle;
  }

  // ─── My History ───────────────────────────────────────────────────────────

  async getMyHistory(userId: string, tenantId: string) {
    const student = await this.getStudent(userId);

    const participations = await this.participantRepo.find({
      where: { studentId: student.id },
      relations: ['battle'],
      order: { joinedAt: 'DESC' },
    });

    return participations
      .filter(p => p.battle?.tenantId === tenantId)
      .slice(0, 20)
      .map(p => ({
        battleId: p.battleId,
        roomCode: p.battle.roomCode,
        mode: p.battle.mode,
        status: p.battle.status,
        topicName: null,
        roundsWon: p.roundsWon,
        eloChange: p.eloChange ?? 0,
        xpEarned: p.xpEarned ?? 0,
        isWinner: p.battle.winnerId === student.id,
        endedAt: p.battle.endedAt,
      }));
  }

  // ─── My ELO ───────────────────────────────────────────────────────────────

  async getMyElo(userId: string, tenantId: string) {
    const student = await this.getStudent(userId);
    const elo = await this.getOrCreateElo(student.id, tenantId);
    return {
      eloRating: elo.eloRating,
      xpPoints: student.xpTotal ?? 0,
      tier: elo.tier,
      battleXp: elo.battleXp,
      battlesPlayed: elo.battlesPlayed,
      battlesWon: elo.battlesWon,
      winStreak: elo.winStreak,
    };
  }

  async getBattleLeaderboard(userId: string, tenantId: string) {
    const rows = await this.dataSource.query(
      `
      SELECT
        s.id AS "studentId",
        u.full_name AS "name",
        COALESCE(se.battle_xp, 0)::int AS "score",
        COALESCE(se.tier::text, 'iron') AS "eloTier",
        u.profile_picture_url AS "avatarUrl"
      FROM students s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN student_elo se ON se.student_id = s.id
      WHERE s.tenant_id = $1
      ORDER BY COALESCE(se.battle_xp, 0) DESC, u.full_name ASC
      `,
      [tenantId],
    );

    const data = (rows || []).map((row: any, idx: number) => ({
      rank: idx + 1,
      studentId: row.studentId,
      name: row.name || 'Student',
      score: Number(row.score || 0),
      eloTier: row.eloTier || 'iron',
      avatarUrl: row.avatarUrl || null,
    }));

    const me = await this.getStudent(userId);
    const myRow = data.find((x: any) => x.studentId === me.id);

    return {
      data: data.slice(0, 100),
      currentStudentRank: myRow ? { rank: myRow.rank, score: myRow.score } : null,
    };
  }

  // ─── Get Daily Battle ─────────────────────────────────────────────────────

  async getDailyBattle(tenantId: string) {
    try {
      const battles = await this.battleRepo.find({
        where: { tenantId, mode: BattleMode.DAILY },
        order: { createdAt: 'DESC' },
        take: 1,
      });
      const battle = battles[0];
      if (!battle) return null;

      // Fetch topic name separately to avoid join issues
      let topicName: string | null = null;
      if (battle.topicId) {
        const topic = await this.dataSource.getRepository(Topic).findOne({ where: { id: battle.topicId } });
        topicName = topic?.name ?? null;
      }

      return {
        battleId: battle.id,
        roomCode: battle.roomCode,
        status: battle.status,
        topicName,
        scheduledAt: battle.scheduledAt,
      };
    } catch (err) {
      this.logger.error('getDailyBattle error', err);
      return null;
    }
  }

  // ─── Get Questions for a Battle ───────────────────────────────────────────

  async getBattleQuestions(battleId: string) {
    let attempts = 0;
    while (attempts < 25) {
      // 1. Check in-memory cache
      const memQuestions = this.aiBattleQuestionsByBattleId.get(battleId) ?? [];
      if (memQuestions.length > 0) {
        return memQuestions.map((q) => ({
          id: q.id,
          text: q.text,
          options: q.options.map((o) => ({ id: o.id, text: o.text })),
          correctId: q.options.find((o) => o.isCorrect)?.id,
        }));
      }

      const battle = await this.battleRepo.findOne({ where: { id: battleId } });
      if (!battle) return [];

      // 2. Fall back to aiQuestions persisted in replayData
      const persisted: AiBattleQuestion[] = battle.replayData?.aiQuestions ?? [];
      if (persisted.length > 0) {
        this.aiBattleQuestionsByBattleId.set(battleId, persisted);
        return persisted.map((q) => ({
          id: q.id,
          text: q.text,
          options: q.options.map((o) => ({ id: o.id, text: o.text })),
          correctId: q.options.find((o) => o.isCorrect)?.id,
        }));
      }

      // 3. Fall back to DB question IDs
      if (battle.questionIds?.length > 0) {
        const questions = await this.questionRepo.find({
          where: battle.questionIds.map(id => ({ id })),
          relations: ['options'],
        });
        return battle.questionIds.map(id => {
          const q = questions.find(q => q.id === id);
          if (!q) return null;
          return {
            id: q.id,
            text: q.content,
            options: q.options.map(o => ({ id: o.id, text: o.content })),
            correctId: q.options.find(o => o.isCorrect)?.id,
          };
        }).filter(Boolean);
      }

      // If no questions found and it's a battle that should have AI questions, wait a bit
      if (battle.mode !== BattleMode.BOT_PRACTICE) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        attempts++;
      } else {
        break; // Non-AI battles shouldn't poll if questions are missing
      }
    }
    return [];
  }

  // ─── Submit Answer ────────────────────────────────────────────────────────

  async submitAnswer(data: {
    battleId: string;
    questionId: string;
    optionId: string;
    roundNumber: number;
    responseTimeMs: number;
    studentId: string;
  }): Promise<any> {
    const participant = await this.participantRepo.findOne({
      where: { battleId: data.battleId, studentId: data.studentId },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    const aiQuestions = this.aiBattleQuestionsByBattleId.get(data.battleId) ?? [];
    const aiQuestion = aiQuestions.find((q) => q.id === data.questionId);
    const aiCorrectOption = aiQuestion?.options.find((o) => o.isCorrect);

    const question = (aiQuestion || !data.questionId)
      ? null
      : await this.questionRepo.findOne({
          where: { id: data.questionId },
          relations: ['options'],
        });

    const correctOptionId =
      aiCorrectOption?.id ??
      question?.options.find((o) => o.isCorrect)?.id ??
      null;

    const existing = await this.answerRepo.findOne({
      where: { battleId: data.battleId, participantId: participant.id, roundNumber: data.roundNumber },
    });
    if (existing) {
      const battle = await this.battleRepo.findOne({ where: { id: data.battleId } });
      const roundAnswersCount = await this.answerRepo.count({
        where: { battleId: data.battleId, roundNumber: data.roundNumber },
      });
      const participantCount = await this.participantRepo.count({ where: { battleId: data.battleId } });
      return { roundComplete: roundAnswersCount >= participantCount };
    }
    const isCorrect = correctOptionId !== null && correctOptionId === data.optionId;

    // AI question IDs (e.g. "ai_1_xxx") are not real DB UUIDs — store null.
    // Also guard against empty-string ("") which forceCompleteRound passes when
    // there is no current question — Postgres rejects "" for UUID columns.
    const dbQuestionId = (aiQuestion || !data.questionId) ? null : data.questionId;
    const dbOptionId   = data.optionId || null;

    await this.answerRepo.save(
      this.answerRepo.create({
        battleId: data.battleId,
        participantId: participant.id,
        questionId: dbQuestionId,
        roundNumber: data.roundNumber,
        selectedOptionId: dbOptionId,
        isCorrect,
        responseTimeMs: data.responseTimeMs,
      }),
    );

    const roundAnswers = await this.answerRepo.count({
      where: { battleId: data.battleId, roundNumber: data.roundNumber },
    });

    const battle = await this.battleRepo.findOne({ where: { id: data.battleId } });
    const participantCount = await this.participantRepo.count({ where: { battleId: data.battleId } });

    if (roundAnswers >= participantCount) {
      const answers = await this.answerRepo.find({
        where: { battleId: data.battleId, roundNumber: data.roundNumber },
        relations: ['participant'],
      });

      let roundWinnerId: string | null = null;
      const correctAnswers = answers.filter(a => a.isCorrect);
      if (correctAnswers.length > 0) {
        const fastest = correctAnswers.sort((a, b) => a.responseTimeMs - b.responseTimeMs)[0];
        roundWinnerId = fastest.participant.studentId;
        await this.participantRepo.increment({ id: fastest.participantId }, 'roundsWon', 1);
      }

      const allParticipants = await this.participantRepo.find({ where: { battleId: data.battleId } });
      const scores: Record<string, number> = {};
      for (const p of allParticipants) scores[p.studentId] = p.roundsWon;

      const battleComplete = data.roundNumber >= battle.totalRounds;
      let nextQuestion = null;
      if (!battleComplete) {
        const questions = await this.getBattleQuestions(data.battleId);
        nextQuestion = questions[data.roundNumber] ?? null;
      }

      return {
        roundComplete: true,
        roundNumber: data.roundNumber,
        roundWinnerId,
        correctOptionId,
        scores,
        battleComplete,
        nextQuestion,
        secondsPerRound: battle.secondsPerRound,
      };
    }

    return { roundComplete: false };
  }

  async forceCompleteRound(battleId: string, roundNumber: number) {
    const battle = await this.battleRepo.findOne({ where: { id: battleId } });
    if (!battle) return null;

    const participants = await this.participantRepo.find({ where: { battleId } });
    const answers = await this.answerRepo.find({ where: { battleId, roundNumber } });
    const answeredParticipantIds = new Set(answers.map(a => a.participantId));

    const questions = await this.getBattleQuestions(battleId);
    const currentQuestion = questions[roundNumber - 1];
    const qId = currentQuestion?.id ?? "";

    let lastResult = { roundComplete: false } as any;

    for (const p of participants) {
      if (!answeredParticipantIds.has(p.id)) {
        lastResult = await this.submitAnswer({
          battleId,
          studentId: p.studentId,
          questionId: qId,
          roundNumber,
          optionId: "",
          responseTimeMs: (battle.secondsPerRound || 30) * 1000,
        });
      }
    }

    return lastResult.roundComplete ? lastResult : null;
  }

  // ─── Finish Battle ────────────────────────────────────────────────────────

  async finishBattle(battleId: string) {
    const participants = await this.participantRepo.find({ where: { battleId } });
    const sorted = [...participants].sort((a, b) => b.roundsWon - a.roundsWon || a.id.localeCompare(b.id));
    const top = sorted[0];
    const second = sorted[1];
    const isDraw =
      participants.length >= 2 &&
      top &&
      second &&
      top.roundsWon === second.roundsWon;
    const winnerStudentId = isDraw ? null : top?.studentId ?? null;

    const correctAnswersRaw = await this.answerRepo
      .createQueryBuilder('a')
      .innerJoin('a.participant', 'part')
      .where('a.battleId = :battleId', { battleId })
      .andWhere('a.isCorrect = true')
      .andWhere('a.deletedAt IS NULL')
      .select('part.studentId', 'sid')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('part.studentId')
      .getRawMany<{ sid: string; cnt: string }>();
    const correctByStudent = new Map<string, number>();
    for (const row of correctAnswersRaw) {
      correctByStudent.set(row.sid, Number(row.cnt ?? 0));
    }

    const XP_PER_CORRECT = 12;
    const WIN_BONUS = 40;
    const LOSS_BONUS = 18;
    const DRAW_BONUS = 28;

    await this.battleRepo.update(battleId, {
      status: BattleStatus.FINISHED,
      winnerId: winnerStudentId as any,
      endedAt: new Date(),
    });

    const K = 32;
    const studentRepo = this.dataSource.getRepository(Student);

    for (const p of participants) {
      const opponent = participants.find(op => op.studentId !== p.studentId);
      const isWinner = !isDraw && winnerStudentId !== null && p.studentId === winnerStudentId;
      const expected = 1 / (1 + Math.pow(10, ((opponent?.eloBefore || 1000) - p.eloBefore) / 400));
      let actual: number;
      if (isDraw) {
        actual = 0.5;
      } else {
        actual = isWinner ? 1 : 0;
      }
      const newElo = Math.round(p.eloBefore + K * (actual - expected));
      const eloChange = newElo - p.eloBefore;

      const correctCount = correctByStudent.get(p.studentId) ?? 0;
      let xpEarned = correctCount * XP_PER_CORRECT;
      if (isDraw) xpEarned += DRAW_BONUS;
      else if (isWinner) xpEarned += WIN_BONUS;
      else xpEarned += LOSS_BONUS;

      await this.participantRepo.update(p.id, { eloAfter: newElo, eloChange, xpEarned });

      await studentRepo.increment({ id: p.studentId }, 'xpTotal', xpEarned);

      await this.eloRepo
        .createQueryBuilder()
        .update(StudentElo)
        .set({
          eloRating: newElo,
          tier: this.getEloTier(newElo),
          battleXp: () => `battle_xp + ${xpEarned}`,
          battlesPlayed: () => 'battles_played + 1',
          battlesWon: isWinner ? () => 'battles_won + 1' : undefined,
          winStreak: isWinner ? () => 'win_streak + 1' : 0,
        })
        .where('studentId = :studentId', { studentId: p.studentId })
        .execute()
        .catch(() =>
          this.eloRepo.save(
            this.eloRepo.create({
              studentId: p.studentId,
              eloRating: newElo,
              tier: this.getEloTier(newElo),
              battleXp: xpEarned,
              battlesPlayed: 1,
              battlesWon: isWinner ? 1 : 0,
              winStreak: isWinner ? 1 : 0,
            }),
          ),
        );
    }

    const finalParticipants = await this.participantRepo.find({
      where: { battleId },
      relations: ['student', 'student.user'],
    });

    this.aiBattleQuestionsByBattleId.delete(battleId);

    const finalScores = finalParticipants.map(p => ({
      studentId: p.studentId,
      name: (p.student as any)?.user?.fullName ?? 'Player',
      roundsWon: p.roundsWon,
      correctAnswers: correctByStudent.get(p.studentId) ?? 0,
      eloChange: p.eloChange ?? 0,
      xpEarned: p.xpEarned ?? 0,
      newElo: p.eloAfter ?? p.eloBefore,
    }));

    return {
      winnerId: winnerStudentId,
      isDraw: !!isDraw,
      finalScores,
    };
  }

  // ─── Get room participants ────────────────────────────────────────────────

  async getRoomParticipants(roomCode: string) {
    const battle = await this.battleRepo.findOne({ where: { roomCode } });
    if (!battle) return [];
    return this.participantRepo.find({
      where: { battleId: battle.id },
      relations: ['student', 'student.user'],
    });
  }

  async getRoomParticipantsFormatted(roomCode: string) {
    const raw = await this.getRoomParticipants(roomCode);
    return raw.map(p => ({
      studentId: p.studentId,
      name: (p.student as any)?.user?.fullName ?? (p.student as any)?.user?.full_name ?? 'Player',
      avatarUrl: (p.student as any)?.user?.profilePictureUrl ?? (p.student as any)?.user?.profile_picture_url ?? null,
      roundsWon: p.roundsWon ?? 0,
      totalScore: p.totalScore ?? 0,
      isBot: p.isBot ?? false,
    }));
  }

  async getStudentPrimaryBatchId(studentId: string): Promise<string | null> {
    const enrollment = await this.dataSource.getRepository(Enrollment).findOne({
      where: { studentId, status: EnrollmentStatus.ACTIVE },
      order: { enrolledAt: 'DESC' },
    });
    return enrollment?.batchId ?? null;
  }

  /**
   * Returns the exam target (jee/neet/both) for a student so the lobby
   * can group players who are preparing for the same exam together.
   * Falls back to the batch's examTarget if the student profile has none.
   */
  async getStudentExamTarget(studentId: string): Promise<string | null> {
    const student = await this.dataSource
      .getRepository(Student)
      .findOne({ where: { id: studentId } });

    if (student?.examTarget) return student.examTarget as string;

    // Fallback: check the batch's examTarget through enrollment
    const enrollment = await this.dataSource.getRepository(Enrollment).findOne({
      where: { studentId, status: EnrollmentStatus.ACTIVE },
      relations: ['batch'],
      order: { enrolledAt: 'DESC' },
    });
    return (enrollment?.batch as any)?.examTarget ?? null;
  }

  // ─── Lobby users (real profiles + elo) ────────────────────────────────────

  async getLobbyUsersByStudentIds(studentIds: string[], tenantId: string) {
    if (!studentIds.length) return [];

    // studentIds are already tenant-scoped by the gateway's in-memory onlineUsers map.
    // Avoid re-filtering by Student.tenantId here because legacy/migrated data can have
    // stale tenant linkage and incorrectly hide valid online students from the lobby.
    const rows = await this.dataSource
      .getRepository(Student)
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.user', 'u')
      .leftJoin(StudentElo, 'elo', 'elo.student_id = s.id')
      .select([
        's.id AS "studentId"',
        'u.full_name AS "name"',
        'u.profile_picture_url AS "avatarUrl"',
        'COALESCE(s.xp_total, 0) AS "xpPoints"',
        'COALESCE(elo.elo_rating, 1000) AS "eloRating"',
        'COALESCE(elo.tier, :defaultTier) AS "tier"',
      ])
      .where('1=1')
      .andWhere('s.id IN (:...studentIds)', { studentIds })
      .setParameter('defaultTier', EloTier.IRON)
      .getRawMany<{
        studentId: string;
        name: string | null;
        avatarUrl: string | null;
        xpPoints: string | number;
        eloRating: string | number;
        tier: string;
      }>();

    const enrollments = await this.dataSource.getRepository(Enrollment).find({
      where: { studentId: In(studentIds), status: EnrollmentStatus.ACTIVE },
      select: ['studentId', 'batchId']
    });

    const userMap = new Map<string, string[]>();
    for (const enr of enrollments) {
      if (!userMap.has(enr.studentId)) userMap.set(enr.studentId, []);
      userMap.get(enr.studentId)!.push(enr.batchId);
    }

    return rows.map(r => ({
      studentId: r.studentId,
      name: r.name ?? 'Player',
      avatarUrl: r.avatarUrl ?? null,
      xpPoints: Number(r.xpPoints ?? 0),
      eloRating: Number(r.eloRating ?? 1000),
      tier: (r.tier ?? EloTier.IRON).toLowerCase(),
      batchIds: userMap.get(r.studentId) || [],
    }));
  }

  // ─── Get battle questions by roomCode (for gateway) ──────────────────────

  async getBattleQuestionsByRoom(roomCode: string) {
    const battle = await this.battleRepo.findOne({ where: { roomCode } });
    if (!battle) return [];
    return this.getBattleQuestions(battle.id);
  }

  // ─── Bot Practice Questions ───────────────────────────────────────────────

  async getBotPracticeQuestions(
    scope: 'subject' | 'chapter' | 'topic',
    scopeId: string,
    count: number,
    tenantId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
    userId?: string,
  ) {
    const limit = Math.min(Math.max(count || 10, 1), 50);
    const diffEnum =
      difficulty === 'easy' ? DifficultyLevel.EASY : difficulty === 'hard' ? DifficultyLevel.HARD : DifficultyLevel.MEDIUM;

    // ── Resolve student's exam target so we can filter level-appropriate questions ──
    let examTarget: string | null = null;
    if (userId) {
      try {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (student) examTarget = await this.getStudentExamTarget(student.id);
      } catch {
        // ignore — fallback to no exam filter
      }
    }
    const examTag = examTarget ? `exam:${String(examTarget).toLowerCase()}` : null;

    // ── Step 1: Try DB first, with strict scope + difficulty + (when possible) exam tag ──
    const qb = this.questionRepo
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.options', 'options')
      .leftJoinAndSelect('q.topic', 'topic')
      .leftJoinAndSelect('topic.chapter', 'chapter')
      .leftJoinAndSelect('chapter.subject', 'subject')
      .where('q.tenantId = :tenantId AND q.isActive = true', { tenantId })
      .andWhere('q.difficulty = :botDiff', { botDiff: diffEnum });

    if (scope === 'topic') {
      qb.andWhere('q.topicId = :scopeId', { scopeId });
    } else if (scope === 'chapter') {
      qb.andWhere('topic.chapterId = :scopeId', { scopeId });
    } else {
      qb.andWhere('subject.id = :scopeId', { scopeId });
    }

    // Prefer questions tagged for this exam if any exist; otherwise fall back to all.
    if (examTag) {
      qb.andWhere(
        '(q.tags IS NULL OR :examTag = ANY(q.tags) OR NOT EXISTS (SELECT 1 FROM questions q2 WHERE q2.tenant_id = q.tenant_id AND q2.is_active = true AND q2.difficulty = q.difficulty AND :examTag = ANY(q2.tags) ' +
        (scope === 'topic'
          ? 'AND q2.topic_id = q.topic_id'
          : scope === 'chapter'
            ? 'AND q2.topic_id IN (SELECT t2.id FROM topics t2 WHERE t2.chapter_id = topic.chapter_id)'
            : 'AND q2.topic_id IN (SELECT t2.id FROM topics t2 LEFT JOIN chapters c2 ON c2.id = t2.chapter_id WHERE c2.subject_id = subject.id)') +
        '))',
        { examTag },
      );
    }

    qb.orderBy('RANDOM()').limit(limit);
    let questions = await qb.getMany();

    // ── Step 2: AI fallback if DB has no level-appropriate questions for this scope ──
    if (questions.length === 0) {
      this.logger.log(
        `[bot-questions] DB empty for scope=${scope} scopeId=${scopeId} diff=${difficulty} exam=${examTarget ?? '—'} → AI generating`,
      );
      try {
        const ai = await this.buildAiBattleQuestions(
          tenantId,
          limit,
          scope === 'topic' ? scopeId : null,
          examTarget ?? undefined,
          undefined,
          difficulty,
          undefined,
          scope === 'subject' ? scopeId : undefined,
          scope === 'chapter' ? scopeId : undefined,
        );
        // Map AiBattleQuestion → BotPracticeQuestion shape (uses synthetic IDs)
        return ai.map((q, i) => ({
          id: q.id || `ai-bot-${Date.now()}-${i}`,
          text: q.text,
          options: q.options.map(o => ({ id: o.id, text: o.text })),
          correctId: q.options.find(o => o.isCorrect)?.id ?? null,
          difficulty,
        }));
      } catch (e: any) {
        this.logger.warn(`[bot-questions] AI fallback failed: ${e?.message}`);
        return [];
      }
    }

    return questions.map(q => ({
      id: q.id,
      text: q.content,
      options: q.options
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(o => ({ id: o.id, text: o.content })),
      correctId: q.options.find(o => o.isCorrect)?.id ?? null,
      difficulty: q.difficulty,
    }));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private generateRoomCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private async resolveAiTopics(
    tenantId: string,
    preferredTopicId?: string | null,
    batchId?: string,
    requestedCount: number = 0, // 0 means all topics
    subjectId?: string,
    chapterId?: string,
  ): Promise<Topic[]> {
    const topicRepo = this.dataSource.getRepository(Topic);

    if (preferredTopicId) {
      const topic =
        (await topicRepo.findOne({
          where: { id: preferredTopicId, tenantId, isActive: true },
          relations: ['chapter', 'chapter.subject'],
        })) ??
        (await topicRepo.findOne({
          where: { id: preferredTopicId, isActive: true },
          relations: ['chapter', 'chapter.subject'],
        }));
      return topic ? [topic] : [];
    }

    const query = topicRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.chapter', 'chapter')
      .leftJoinAndSelect('chapter.subject', 'subject')
      .where('t.is_active = true');

    if (batchId) {
      query.andWhere(
        '(subject.batch_id = :batchId OR LOWER(subject.name) IN (SELECT LOWER(subject_name) FROM batch_subject_teachers WHERE batch_id = :batchId))',
        { batchId }
      );
    }
    if (subjectId) {
      query.andWhere('chapter.subject_id = :subjectId', { subjectId });
    }
    if (chapterId) {
      query.andWhere('t.chapter_id = :chapterId', { chapterId });
    }
    if (tenantId) {
      query.andWhere('t.tenant_id = :tenantId', { tenantId });
    }

    if (requestedCount > 0) {
      query.limit(requestedCount);
    }

    const topics = await query.orderBy('RANDOM()').getMany();

    if (topics.length > 0) return topics;

    // Fallback: any active topics in the tenant
    const fallbackQuery = topicRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.chapter', 'chapter')
      .leftJoinAndSelect('chapter.subject', 'subject')
      .where('t.tenant_id = :tenantId AND t.is_active = true', { tenantId });
      
    if (batchId) {
      fallbackQuery.andWhere(
        '(subject.batch_id = :batchId OR LOWER(subject.name) IN (SELECT LOWER(subject_name) FROM batch_subject_teachers WHERE batch_id = :batchId))',
        { batchId }
      );
    }
    
    return fallbackQuery
      .orderBy('RANDOM()')
      .limit(requestedCount)
      .getMany();
  }

  // Maps exam target keys to human-readable labels for AI prompting
  private readonly examLevelLabel: Record<string, string> = {
    [ExamTarget.JEE]:          'JEE Advanced level',
    [ExamTarget.NEET]:         'NEET level',
    [ExamTarget.BOTH]:         'JEE/NEET level',
    [ExamTarget.JEE_MAINS]:    'JEE Mains level',
    [ExamTarget.JEE_ADVANCED]: 'JEE Advanced level',
    [ExamTarget.FOUNDATION]:   'Foundation level (Class 8-10)',
    [ExamTarget.OTHER]:        'Competitive level',
  };

  private getTopicCacheKey(
    topicId: string,
    examTarget?: string,
    difficulty?: 'easy' | 'medium' | 'hard',
  ): string {
    return `${topicId}:${examTarget ?? 'general'}:${difficulty ?? 'auto'}`;
  }

  private getFromTopicCache(key: string): AiBattleQuestion[] | null {
    const entry = this.topicQuestionsCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this.TOPIC_CACHE_TTL_MS) {
      this.topicQuestionsCache.delete(key);
      return null;
    }
    this.logger.log(`[cache-hit] retrieved ${entry.questions.length} questions from key ${key}`);
    return entry.questions;
  }

  private saveToTopicCache(key: string, questions: AiBattleQuestion[]): void {
    if (questions.length > 0) {
      this.topicQuestionsCache.set(key, { questions, cachedAt: Date.now() });
    }
  }

  private _normalizeMathDelimiters(text: string): string {
    let t = String(text || '')
      // AI often sends double backslashes in JSON which becomes single, but if it sends single it gets mangled.
      .replace(/\\\\/g, '\\')
      // Convert LaTeX bracket math to markdown math delimiters
      .replace(/\\\[((?:.|\n)*?)\\\]/g, (_, inner) => `\n\n$$${inner}$$\n\n`)
      .replace(/\\\(((?:.|\n)*?)\\\)/g, (_, inner) => `$${inner}$`)
      // Common stripping fixes: rac -> \frac, int_ -> \int_, sqrt -> \sqrt
      .replace(/(^|[^A-Za-z\\])rac\{/g, '$1\\frac{')
      .replace(/(^|[^A-Za-z\\])(sqrt|int|sum|lim|sin|cos|tan|theta|alpha|beta|gamma|delta|pi|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)\{/g, '$1\\$2{')
      .replace(/(^|[^A-Za-z\\])(int_|sum_|lim_|theta|alpha|beta|gamma|delta|pi|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)([^a-z])/g, '$1\\$2$3')
      .replace(/x\s*o\s*(\d+|[a-z])/gi, 'x \\to $1')
      .replace(/x\s*->\s*(\d+|[a-z])/gi, 'x \\to $1');

    // Heuristic: if it looks like it has LaTeX commands but no $ delimiters, wrap the whole string.
    // We use \text{ } to preserve spaces in KaTeX math mode.
    if (!t.includes('$') && /[\\^_]/.test(t)) {
      return `$$${t.replace(/ /g, '\\text{ }')}$$`;
    }
    return t;
  }

  /** Group duplicate stems so we can drop repeat questions in one battle. */
  private _battleQuestionDedupeKey(text: string): string {
    const t = String(text || '')
      .toLowerCase()
      .replace(/[0-9]+/g, '#')
      .replace(/[^a-z#\u0900-\u0fff\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return t.slice(0, 220);
  }

  /**
   * Round-robin interleave: takes one question from each pool in turn so every
   * source is represented before any source gets a second slot.
   * e.g. pools = [[t0,t1,t2], [n0,n1], [c0]] \u2192 [t0, n0, c0, t1, n1, t2]
   */
  private _interleaveQuestionPools(pools: AiBattleQuestion[][]): AiBattleQuestion[] {
    const result: AiBattleQuestion[] = [];
    const maxLen = Math.max(...pools.map(p => p.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const pool of pools) {
        if (i < pool.length) result.push(pool[i]);
      }
    }
    return result;
  }

  /**
   * MCQ for battle: exactly 4 options (A–D), one correct, no duplicate stems.
   */
  private normalizeAiQuestions(raw: any[], safeCount: number): AiBattleQuestion[] {
    const seen = new Set<string>();
    const out: AiBattleQuestion[] = [];
    const rows = Array.isArray(raw) ? raw : [];

    for (const q of rows) {
      if (out.length >= safeCount) break;

      const text = this._normalizeMathDelimiters(
        String(q?.content ?? q?.questionText ?? q?.question_text ?? q?.question ?? q?.text ?? ''),
      ).trim();
      if (!text) continue;

      let optionsRaw = Array.isArray(q?.options) ? q.options : [];
      const mapped = optionsRaw.map((opt: any, oIndex: number) => {
        const t = this._normalizeMathDelimiters(
          String(typeof opt === 'string' ? opt : opt?.content ?? opt?.text ?? opt?.value ?? ''),
        ).trim();
        const id = String(
          typeof opt === 'object' && opt?.label
            ? opt.label
            : String.fromCharCode(65 + oIndex),
        )
          .toUpperCase()
          .replace(/[^A-Z]/g, '');
        return {
          id: id.length ? id[0]! : String.fromCharCode(65 + oIndex),
          text: t,
          isCorrect: Boolean(
            typeof opt === 'object' && opt
              ? opt.isCorrect
              : false,
          ),
        };
      });

      if (mapped.length >= 4 && !mapped.some((o) => o.isCorrect)) {
        const letter = String(
          (q as any).correctOption ?? (q as any).answer ?? (q as any).correctAnswer ?? '',
        )
          .trim()
          .toUpperCase()
          .match(/^[A-D]/)?.[0];
        if (letter) {
          const idx = letter.charCodeAt(0) - 65;
          if (idx >= 0 && idx < mapped.length) {
            mapped.forEach((o, i) => {
              o.isCorrect = i === idx;
            });
          }
        }
      }

      if (mapped.length < 4) continue;

      // Keep only A–D for battle; if >4, use first 4 only if the correct option is A–D
      let slice = mapped;
      if (mapped.length > 4) {
        const ci = mapped.findIndex((o) => o.isCorrect);
        if (ci < 0 || ci > 3) continue;
        slice = mapped.slice(0, 4);
      }

      const four = slice.slice(0, 4);
      if (four.some((o) => !o.text)) continue;
      if (!four.some((o) => o.isCorrect)) continue;

      // Unique options check
      const optionTexts = new Set(four.map(o => o.text.trim().toLowerCase()));
      if (optionTexts.size < 4) continue;

      const options: AiBattleQuestion['options'] = four.map((o, i) => ({
        id: String.fromCharCode(65 + i),
        text: o.text,
        isCorrect: Boolean(o.isCorrect),
      }));

      const key = this._battleQuestionDedupeKey(text);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);

      out.push({
        id: `ai_${out.length + 1}_${Math.random().toString(36).slice(2, 7)}`,
        text,
        options,
        meta: (q as any).meta ?? null,
      });
    }
    return out;
  }

  private async buildAiBattleQuestions(
    tenantId: string,
    count: number,
    preferredTopicId?: string | null,
    examTarget?: string | ExamTarget,
    explicitTopicName?: string,
    requestedDifficulty?: 'easy' | 'medium' | 'hard',
    batchId?: string,             // when set, restrict random topics to this course
    subjectId?: string,           // when set, restrict random topics to this subject
    chapterId?: string,           // when set, restrict random topics to this chapter
    isChallengeAFriendFullSyllabus?: boolean,
  ): Promise<AiBattleQuestion[]> {
    const safeCount = Math.min(Math.max(count || 10, 3), 20);

    // Resolve the full set of DB topic records for this scope
    const topics = await this.resolveAiTopics(tenantId, preferredTopicId, batchId, 0, subjectId, chapterId);
    const firstTopic = topics[0];

    // Calculate unique subjects and chapters for context (deduplicated, used for filter & prompt)
    const uniqueSubjects = Array.from(new Set(topics.map((t: any) => t.chapter?.subject?.name).filter(Boolean)));
    const uniqueChapters = Array.from(new Set(topics.map((t: any) => t.chapter?.name).filter(Boolean)));

    // Separate logic for Full Syllabus to prevent subject leakage and keep prompt size small
    let baseName = explicitTopicName?.trim() || firstTopic?.name || 'General Science';
    let promptHint = '';

    if (isChallengeAFriendFullSyllabus) {
      const subjectStr = uniqueSubjects.join(', ');
      // Use subjects in the name to anchor the AI specifically to the batch curriculum
      baseName = uniqueSubjects.length > 0 ? `${subjectStr} Full Syllabus` : baseName;
      promptHint = ` (COMPREHENSIVE SYLLABUS CHALLENGE: This is a full-course battle for the subjects: ${subjectStr || 'Biology'}. You MUST ONLY generate questions from these subjects. Strictly avoid any other subjects like Physics, Chemistry, or Math if not listed.)`;
    } else if (firstTopic?.chapter?.subject && !baseName.includes('Chapter:')) {
      promptHint = ` (Context: Chapter ${firstTopic.chapter.name}, Subject ${firstTopic.chapter.subject.name})`;
    }

    const examLabel = examTarget ? this.examLevelLabel[examTarget] : null;
    const enrichedTopicName = examLabel ? `${baseName} (${examLabel})${promptHint}` : `${baseName}${promptHint}`;

    const derivedDifficulty: 'easy' | 'medium' | 'hard' =
      requestedDifficulty ??
      (examTarget === ExamTarget.JEE ||
      examTarget === ExamTarget.JEE_ADVANCED ||
      examTarget === 'jee_advanced'
        ? 'hard'
        : 'medium');

    // Strict difficulty enforcement for AI: if requested, it must be the ONLY source of truth.
    const strictDifficulty = requestedDifficulty || derivedDifficulty;

    const cacheKey = this.getTopicCacheKey(
      preferredTopicId ?? (topics.length === 1 ? topics[0].id : (batchId || 'mixed')),
      examTarget,
      strictDifficulty,
    );

    if (topics.length === 0 && !explicitTopicName) {
      this.logger.warn(`No topics resolved for AI battle generation (tenant=${tenantId})`);
    }

    // Fetch in-video notes (AI notes, concepts, formulas, transcript) from lectures for these topics.
    // Also collect quiz checkpoint questions embedded in videos as ready-made battle questions.
    // Prioritize lectures assigned to this specific batch (course) if provided.
    // Cap at 5 topics to keep DB fetch time bounded regardless of syllabus size.
    let lectureNotes: string[] = [];
    const checkpointQuestions: AiBattleQuestion[] = [];
    if (topics.length > 0 && tenantId) {
      const lectureRepo = this.dataSource.getRepository(Lecture);
      const topicsForNotes = topics.slice(0, 5);

      for (const t of topicsForNotes) {
        // Try fetching batch-specific lectures first
        let lectures = batchId
          ? await lectureRepo.find({
              where: { topicId: t.id, tenantId, batchId },
              select: ['id', 'aiNotesMarkdown', 'aiKeyConcepts', 'aiFormulas', 'transcript', 'quizCheckpoints'],
            })
          : [];

        // Fallback to topic-wide lectures in this tenant if no batch-specific notes found
        if (lectures.length === 0) {
          lectures = await lectureRepo.find({
            where: { topicId: t.id, tenantId },
            select: ['id', 'aiNotesMarkdown', 'aiKeyConcepts', 'aiFormulas', 'transcript', 'quizCheckpoints'],
          });
        }

        for (const lec of lectures) {
          if (lec.aiNotesMarkdown) lectureNotes.push(lec.aiNotesMarkdown);
          if (lec.aiKeyConcepts?.length) lectureNotes.push(`Topic ${t.name} Concepts: ${lec.aiKeyConcepts.join(', ')}`);
          if (lec.aiFormulas?.length) lectureNotes.push(`Topic ${t.name} Formulas: ${lec.aiFormulas.join(', ')}`);
          // Include a truncated transcript excerpt as additional context
          if (lec.transcript) lectureNotes.push(`Lecture Transcript (excerpt): ${lec.transcript.slice(0, 1500)}`);

          // Convert quiz checkpoints embedded in the video into battle questions
          for (const cp of lec.quizCheckpoints ?? []) {
            if (!cp.questionText?.trim() || !cp.options?.length || !cp.correctOption) continue;
            const opts = cp.options.map(o => ({
              id: o.label,
              text: o.text,
              isCorrect: o.label === cp.correctOption,
            }));
            if (opts.length < 2 || !opts.some(o => o.isCorrect) || opts.some(o => !o.text?.trim())) continue;
            const dk = this._battleQuestionDedupeKey(cp.questionText);
            if (checkpointQuestions.some(q => this._battleQuestionDedupeKey(q.text) === dk)) continue;
            checkpointQuestions.push({
              id: `cp_${lec.id}_${cp.id}`,
              text: cp.questionText,
              options: opts,
            });
          }
        }

        // Limit notes to avoid hitting context window limits
        if (lectureNotes.length > 30) break;
      }
    }

    const subjectName = uniqueSubjects.length > 0 
      ? (uniqueSubjects.length > 5 ? uniqueSubjects.slice(0, 5).join(', ') + ' and more' : uniqueSubjects.join(', '))
      : undefined;
      
    // Set chapterName to undefined for full syllabus to completely bypass the single-chapter strict filtering in ai-bridge.
    const chapterName = topics.length > 1 ? undefined : (firstTopic?.chapter?.name ?? undefined);
    
    const hasNotes    = lectureNotes.length > 0;

    // We ask for the FULL safeCount from each source (Topic/Notes) to build a large buffer.
    // This ensures that even if the strict subject filter drops many questions, we still hit 10.
    const perSource = safeCount;

    // Shuffle checkpoints so variety differs between battles
    const shuffledCps = checkpointQuestions.sort(() => Math.random() - 0.5);

    try {
      // ── Fire both AI calls in parallel ───────────────────────────────────────
      // Source A: brand-new questions generated by reading the actual lecture notes
      // Source B: general topic knowledge questions (notes used as context only)
      // Use allSettled so a slow/failing notes call never blocks topic questions.
      const seed = Math.floor(Math.random() * 1000000);
      const [notesResult, topicResult] = await Promise.allSettled([
        hasNotes
          ? this.aiBridgeService.generateQuestionsFromLectureNotes(
              {
                topicName:  enrichedTopicName,
                notes:      lectureNotes,
                count:      perSource + 3,
                difficulty: strictDifficulty,
                examTarget: examTarget ?? undefined,
                subject:    subjectName,
                chapter:    chapterName,
                seed:       seed, // Add randomness
              } as any,
              tenantId,
            )
          : Promise.resolve([]),
        this.aiBridgeService.generateQuestionsFromTopic(
          {
            topicId:    preferredTopicId ?? (topics.length === 1 ? topics[0].id : 'mixed'),
            topicName:  enrichedTopicName,
            count:      perSource + 4,
            difficulty: strictDifficulty,
            type:       'mcq_single',
            examTarget: examTarget ?? undefined,
            notes:      hasNotes ? lectureNotes : undefined,
            subject:    subjectName,
            chapter:    chapterName,
            chapters:   uniqueChapters,
            seed:       seed, // Add randomness
          } as any,
          tenantId,
        ),
      ]);

      const notesAiRaw = notesResult.status === 'fulfilled' ? notesResult.value : [];
      const topicAiRaw = topicResult.status === 'fulfilled' ? topicResult.value : [];
      if (notesResult.status === 'rejected') {
        this.logger.warn(`Notes-AI call failed (non-blocking): ${notesResult.reason?.message}`);
      }

      // Normalise each pool independently (validate 4 options, correct answer, etc.)
      const poolCp    = shuffledCps.slice(0, perSource);                      // Source C: in-video quiz checkpoints
      const poolNotes = this.normalizeAiQuestions(notesAiRaw, perSource);    // Source A
      const poolTopic = this.normalizeAiQuestions(topicAiRaw, perSource);    // Source B

      this.logger.log(
        `Battle question pools — checkpoints: ${poolCp.length}, notes-AI: ${poolNotes.length}, topic-AI: ${poolTopic.length}`,
      );

      // ── Hard subject-scope filter ─────────────────────────────────────────
      // The AI ignores prompt constraints, so we enforce them here by keyword.
      // Build banned keywords from subjects NOT in the allowed list.
      const filterByAllowedSubjects = (pool: AiBattleQuestion[]): AiBattleQuestion[] => {
        if (!isChallengeAFriendFullSyllabus || uniqueSubjects.length === 0) return pool;

        const subjectsLower = uniqueSubjects.map(s => s.toLowerCase());
        const isBioOnly = subjectsLower.every(s =>
          s.includes('botany') || s.includes('zoology') || s.includes('biology') ||
          s.includes('bio') || s.includes('plant') || s.includes('animal'),
        );

        if (!isBioOnly) return pool; // Mixed batch — no filter needed

        // Physics keywords
        const physicsKw = [
          'block of mass', 'velocity', 'acceleration', 'force of', 'newton', 'friction',
          'momentum', 'kinetic energy', 'potential energy', 'projectile', 'circular motion',
          'electric current', 'resistance', 'voltage', 'capacitor', 'magnetic field',
          'refractive index', 'wavelength', 'frequency', 'amplitude', 'spring constant',
          'm/s', 'kg', 'joule', 'watt', 'ohm', 'ampere', 'coulomb', 'tesla',
          'horizontal surface', 'inclined plane', 'pulley', 'torque', 'angular velocity',
          'gravitational', 'centripetal', 'work done by', 'power =', 'displacement',
          'distance traveled', 'time taken to', 'initial velocity', 'final velocity',
        ];
        // Chemistry keywords
        const chemKw = [
          'molarity', 'molality', 'moles of', 'molar mass', 'atomic mass', 'avogadro',
          'ph of', 'acid base', 'buffer solution', 'electrolysis', 'oxidation state',
          'enthalpy', 'entropy', 'gibbs', 'equilibrium constant', 'rate constant',
          'coordination compound', 'valence shell', 'hybridization', 'ionic bond',
          'covalent bond', 'galvanic cell', 'electrolytic cell', 'faraday',
          'periodic table', 'electron configuration', 'quantum number',
        ];
        // Math keywords
        const mathKw = [
          'matrix', 'determinant', 'eigenvalue', 'integral of', 'derivative of',
          'probability of', 'permutation', 'combination', 'binomial theorem',
          'trigonometric', 'sin(', 'cos(', 'tan(', 'log(', 'arithmetic progression',
          'geometric progression', 'vectors in', 'coordinate geometry',
        ];

        const bannedKw = [...physicsKw, ...chemKw, ...mathKw];

        const filtered = pool.filter(q => {
          const text = q.text.toLowerCase();
          const match = bannedKw.find(kw => text.includes(kw.toLowerCase()));
          if (match) {
            this.logger.warn(`[subject-filter] Dropped off-scope question (matched "${match}"): "${q.text.slice(0, 80)}"`);
            return false;
          }
          return true;
        });

        this.logger.log(`[subject-filter] ${pool.length - filtered.length} questions dropped as off-scope, ${filtered.length} kept`);
        return filtered;
      };

      // ── Round-robin interleave for maximum diversity ─────────────────────────
      // Apply hard subject filter BEFORE interleaving to remove off-scope questions
      const filteredTopic = filterByAllowedSubjects(poolTopic);
      const filteredNotes = filterByAllowedSubjects(poolNotes);
      const interleaved = this._interleaveQuestionPools([filteredTopic, filteredNotes, poolCp]);

      const seenKeys = new Set<string>();
      const final: AiBattleQuestion[] = [];
      for (const q of interleaved) {
        if (final.length >= safeCount) break;
        const key = this._battleQuestionDedupeKey(q.text);
        if (key && seenKeys.has(key)) continue;
        if (key) seenKeys.add(key);
        final.push(q);
      }

      if (final.length >= safeCount) {
        this.logger.log(`[buildAiBattleQuestions] returning ${final.length} questions. Sources: ${final.map(q => q.id.split('_')[0]).join(', ')}`);
        if (poolTopic.length >= 3) this.saveToTopicCache(cacheKey, poolTopic);
        return final;
      }

      this.logger.warn(`Combined pool short of target (${final.length}/${safeCount}); attempting to top up from DB fallback...`);
      
      // Top up from DB fallback to ensure we hit the requested count
      const dbFallback = await this.getFallbackDbQuestions(
        tenantId,
        safeCount - final.length, // Only fetch what we need
        isChallengeAFriendFullSyllabus ? undefined : (topics[0]?.id ?? preferredTopicId ?? undefined),
        derivedDifficulty,
        isChallengeAFriendFullSyllabus ? batchId : undefined,
      );
      
      for (const q of dbFallback) {
        if (final.length >= safeCount) break;
        const key = this._battleQuestionDedupeKey(q.text);
        if (key && seenKeys.has(key)) continue;
        if (key) seenKeys.add(key);
        final.push(q);
      }

      if (final.length >= 3) {
        this.logger.log(`[buildAiBattleQuestions] returning ${final.length} questions after DB top-up. Sources: ${final.map(q => q.id.split('_')[0]).join(', ')}`);
        if (poolTopic.length >= 3) this.saveToTopicCache(cacheKey, poolTopic);
        return final;
      }

      this.logger.warn(
        `Combined pool still too small after DB top-up (${final.length}); falling back to cache`,
      );
    } catch (err: any) {
      this.logger.warn(`AI battle generation failed: ${err?.message ?? 'unknown error'}; checking fallbacks`);
    }

    const dedupePool = (pool: AiBattleQuestion[]) => {
      const out: AiBattleQuestion[] = [];
      const seen = new Set<string>();
      for (const q of pool) {
        if (out.length >= safeCount) break;
        const k = this._battleQuestionDedupeKey(q.text);
        if (k && seen.has(k)) continue;
        if (k) seen.add(k);
        out.push(q);
      }
      return out;
    };

    // ── Fallback 1: checkpoints alone (if enough) ────────────────────────────
    if (shuffledCps.length >= 3) {
      return dedupePool(shuffledCps);
    }

    // ── Fallback 2: topic-level cache from a prior battle ────────────────────
    const cached = this.getFromTopicCache(cacheKey);
    if (cached) {
      this.logger.log(`Using topic cache for ${enrichedTopicName} (${cached.length} q)`);
      // Mix cache with any checkpoints we have
      return dedupePool(this._interleaveQuestionPools([cached, shuffledCps]));
    }

    // ── Fallback 3: DB questions ─────────────────────────────────────────────
    const dbFallback = await this.getFallbackDbQuestions(
      tenantId,
      safeCount,
      isChallengeAFriendFullSyllabus ? undefined : (topics[0]?.id ?? preferredTopicId ?? undefined),
      derivedDifficulty,
      isChallengeAFriendFullSyllabus ? batchId : undefined,
    );
    return dedupePool(this._interleaveQuestionPools([dbFallback, shuffledCps]));
  }

  private async getFallbackDbQuestions(
    tenantId: string,
    count: number,
    preferredTopicId?: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
    filterBatchId?: string,
  ): Promise<AiBattleQuestion[]> {
    const baseWhere = 'q.tenantId = :tenantId AND q.isActive = true';
    const diffEnum: DifficultyLevel =
      difficulty === 'easy' ? DifficultyLevel.EASY : difficulty === 'hard' ? DifficultyLevel.HARD : DifficultyLevel.MEDIUM;

    const buildQb = (topicId?: string) => {
      const pool = Math.min(50, Math.max(count * 4, count + 6));
      const qb = this.questionRepo
        .createQueryBuilder('q')
        .leftJoinAndSelect('q.options', 'options')
        .where(baseWhere, { tenantId });

      if (filterBatchId) {
        qb.leftJoin('q.topic', 'topic')
          .leftJoin('topic.chapter', 'chapter')
          .leftJoin('chapter.subject', 'subject')
          .andWhere(
            '(subject.batch_id = :filterBatchId OR LOWER(subject.name) IN (SELECT LOWER(subject_name) FROM batch_subject_teachers WHERE batch_id = :filterBatchId))',
            { filterBatchId }
          );
      }

      qb.andWhere('q.difficulty = :fbDiff', { fbDiff: diffEnum });
        
      if (topicId) qb.andWhere('q.topicId = :topicId', { topicId });
      return qb.orderBy('RANDOM()').limit(pool);
    };

    let dbQuestions = preferredTopicId
      ? await buildQb(preferredTopicId).getMany()
      : [];

    // If no topic-specific questions found, fall back to whole curriculum
    if (dbQuestions.length === 0) {
      dbQuestions = await buildQb().getMany();
    }

    const seenDb = new Set<string>();
    const out: AiBattleQuestion[] = [];
    for (const q of dbQuestions) {
      if (out.length >= count) break;
      const sorted = (q.options ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
      if (sorted.length < 4) continue;
      const four = sorted.slice(0, 4).map((o, oIndex) => ({
        id: String.fromCharCode(65 + oIndex),
        text: o.content,
        isCorrect: Boolean(o.isCorrect),
      }));
      if (!four.some((o) => o.isCorrect) || four.some((o) => !o.text?.trim())) continue;
      
      const optTexts = new Set(four.map((o) => o.text.trim().toLowerCase()));
      if (optTexts.size < 4) continue;

      if (!q.content?.trim()) continue;
      const dk = this._battleQuestionDedupeKey(q.content);
      if (dk && seenDb.has(dk)) continue;
      if (dk) seenDb.add(dk);
      out.push({
        id: `db_${out.length + 1}_${Math.random().toString(36).slice(2, 7)}`,
        text: q.content,
        options: four,
      });
    }
    return out;
  }

  private getEloTier(elo: number): EloTier {
    if (elo < 1100) return EloTier.IRON;
    if (elo < 1300) return EloTier.BRONZE;
    if (elo < 1500) return EloTier.SILVER;
    if (elo < 1700) return EloTier.GOLD;
    if (elo < 1900) return EloTier.PLATINUM;
    if (elo < 2100) return EloTier.DIAMOND;
    return EloTier.CHAMPION;
  }
}
