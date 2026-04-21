import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
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
import { Question } from '../../database/entities/question.entity';
import { Student, ExamTarget } from '../../database/entities/student.entity';
import { Topic } from '../../database/entities/subject.entity';
import { AiBridgeService } from '../ai-bridge/ai-bridge.service';

interface AiBattleQuestion {
  id: string;
  text: string;
  options: { id: string; text: string; isCorrect: boolean }[];
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
  ) {}

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

  async createBattleRoom(userId: string, tenantId: string, mode = BattleMode.QUICK_DUEL, topicId?: string, topicName?: string) {
    const student = await this.getStudent(userId);

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

    const aiQuestions = await this.buildAiBattleQuestions(tenantId, qCount, topicId, student.examTarget ?? undefined, topicName);
    this.aiBattleQuestionsByBattleId.set(battle.id, aiQuestions);
    // Persist questions to DB so they survive server restarts
    battle.questionIds = [];
    battle.replayData = { ...(battle.replayData ?? {}), aiQuestions };
    await this.battleRepo.save(battle);

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

  async createPrivateChallengeRoom(challengerStudentId: string, targetStudentId: string, tenantId: string) {
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
        topicId: null,
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

    const aiQuestions = await this.buildAiBattleQuestions(tenantId, qCount, null, examTarget);
    this.aiBattleQuestionsByBattleId.set(battle.id, aiQuestions);
    battle.questionIds = [];
    battle.replayData = { ...(battle.replayData ?? {}), aiQuestions };
    await this.battleRepo.save(battle);

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
    // 1. Check in-memory cache (fastest, valid within the same server process)
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

    // 2. Fall back to aiQuestions persisted in replayData (survives server restarts)
    const persisted: AiBattleQuestion[] = battle.replayData?.aiQuestions ?? [];
    if (persisted.length > 0) {
      // Restore into memory cache for subsequent calls
      this.aiBattleQuestionsByBattleId.set(battleId, persisted);
      return persisted.map((q) => ({
        id: q.id,
        text: q.text,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
        correctId: q.options.find((o) => o.isCorrect)?.id,
      }));
    }

    // 3. Fall back to DB question IDs (for non-AI battles)
    if (!battle.questionIds?.length) return [];
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

  // ─── Submit Answer ────────────────────────────────────────────────────────

  async submitAnswer(data: {
    battleId: string;
    questionId: string;
    optionId: string;
    roundNumber: number;
    responseTimeMs: number;
    studentId: string;
  }) {
    const participant = await this.participantRepo.findOne({
      where: { battleId: data.battleId, studentId: data.studentId },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    const aiQuestions = this.aiBattleQuestionsByBattleId.get(data.battleId) ?? [];
    const aiQuestion = aiQuestions.find((q) => q.id === data.questionId);
    const aiCorrectOption = aiQuestion?.options.find((o) => o.isCorrect);

    const question = aiQuestion
      ? null
      : await this.questionRepo.findOne({
          where: { id: data.questionId },
          relations: ['options'],
        });

    const correctOptionId =
      aiCorrectOption?.id ??
      question?.options.find((o) => o.isCorrect)?.id ??
      null;
    const isCorrect = correctOptionId !== null && correctOptionId === data.optionId;

    // AI question IDs (e.g. "ai_1_xxx") are not real DB UUIDs — store null
    const dbQuestionId = aiQuestion ? null : data.questionId;

    await this.answerRepo.save(
      this.answerRepo.create({
        battleId: data.battleId,
        participantId: participant.id,
        questionId: dbQuestionId,
        roundNumber: data.roundNumber,
        selectedOptionId: data.optionId,
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
        battleComplete,
        roundWinnerId,
        correctOptionId,
        scores,
        nextQuestion,
        secondsPerRound: battle.secondsPerRound,
      };
    }

    return { roundComplete: false };
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

    return rows.map(r => ({
      studentId: r.studentId,
      name: r.name ?? 'Player',
      avatarUrl: r.avatarUrl ?? null,
      xpPoints: Number(r.xpPoints ?? 0),
      eloRating: Number(r.eloRating ?? 1000),
      tier: (r.tier ?? EloTier.IRON).toLowerCase(),
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
  ) {
    const limit = Math.min(Math.max(count || 10, 1), 50);

    const qb = this.questionRepo
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.options', 'options')
      .leftJoin('q.topic', 'topic')
      .where('q.tenantId = :tenantId AND q.isActive = true', { tenantId });

    if (scope === 'topic') {
      qb.andWhere('q.topicId = :scopeId', { scopeId });
    } else if (scope === 'chapter') {
      qb.andWhere('topic.chapterId = :scopeId', { scopeId });
    } else {
      // subject
      qb.leftJoin('topic.chapter', 'chapter')
        .andWhere('chapter.subjectId = :scopeId', { scopeId });
    }

    qb.orderBy('RANDOM()').limit(limit);
    const questions = await qb.getMany();

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

  private async resolveAiTopic(tenantId: string, preferredTopicId?: string | null): Promise<Topic | null> {
    const topicRepo = this.dataSource.getRepository(Topic);

    if (preferredTopicId) {
      // Try tenant-scoped first, then cross-tenant (topic may belong to a sibling tenant)
      const topic =
        (await topicRepo.findOne({ where: { id: preferredTopicId, tenantId, isActive: true } })) ??
        (await topicRepo.findOne({ where: { id: preferredTopicId, isActive: true } }));
      if (topic) return topic;
    }

    // Random active topic in this tenant
    const tenantTopic = await topicRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId AND t.is_active = true', { tenantId })
      .orderBy('RANDOM()')
      .limit(1)
      .getOne();
    if (tenantTopic) return tenantTopic;

    // If the tenant has no topics at all, pick from any tenant (demo / staging scenario)
    return topicRepo
      .createQueryBuilder('t')
      .where('t.is_active = true')
      .orderBy('RANDOM()')
      .limit(1)
      .getOne();
  }

  // Maps ExamTarget enum values to human-readable exam level labels for AI prompting
  private readonly examLevelLabel: Record<string, string> = {
    [ExamTarget.JEE]:  'JEE Advanced level',
    [ExamTarget.NEET]: 'NEET level',
    [ExamTarget.BOTH]: 'JEE/NEET level',
  };

  private getTopicCacheKey(topicId: string, examTarget?: string): string {
    return `${topicId}:${examTarget ?? 'general'}`;
  }

  private getFromTopicCache(key: string): AiBattleQuestion[] | null {
    const entry = this.topicQuestionsCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this.TOPIC_CACHE_TTL_MS) {
      this.topicQuestionsCache.delete(key);
      return null;
    }
    return entry.questions;
  }

  private saveToTopicCache(key: string, questions: AiBattleQuestion[]): void {
    if (questions.length > 0) {
      this.topicQuestionsCache.set(key, { questions, cachedAt: Date.now() });
    }
  }

  private normalizeAiQuestions(raw: any[], safeCount: number): AiBattleQuestion[] {
    return (Array.isArray(raw) ? raw : [])
      .map((q: any, qIndex: number) => {
        const text = String(q?.content ?? '').trim();
        const optionsRaw = Array.isArray(q?.options) ? q.options : [];
        if (!text || optionsRaw.length < 2) return null;

        const options = optionsRaw.map((opt: any, oIndex: number) => ({
          id: String(opt?.label ?? String.fromCharCode(65 + oIndex)).toUpperCase(),
          text: String(opt?.content ?? opt?.text ?? '').trim(),
          isCorrect: Boolean(opt?.isCorrect),
        }));

        if (options.some((o) => !o.text)) return null;
        if (!options.some((o) => o.isCorrect)) return null;

        return {
          id: `ai_${qIndex + 1}_${Math.random().toString(36).slice(2, 7)}`,
          text,
          options,
        } as AiBattleQuestion;
      })
      .filter((q): q is AiBattleQuestion => Boolean(q))
      .slice(0, safeCount);
  }

  private async buildAiBattleQuestions(
    tenantId: string,
    count: number,
    preferredTopicId?: string | null,
    examTarget?: ExamTarget,
    explicitTopicName?: string,
  ): Promise<AiBattleQuestion[]> {
    const safeCount = Math.min(Math.max(count || 10, 3), 20);

    // Resolve a DB topic record (cross-tenant fallback included)
    const topic = await this.resolveAiTopic(tenantId, preferredTopicId);

    // The topic name used for AI generation: prefer the explicitly provided name
    // (from the frontend scope picker) so the AI uses the exact selected topic,
    // then fall back to the DB record name, then a generic label.
    const baseName = explicitTopicName?.trim() || topic?.name || 'General Science';
    const examLabel = examTarget ? this.examLevelLabel[examTarget] : null;
    const enrichedTopicName = examLabel ? `${baseName} (${examLabel})` : baseName;

    const cacheKey = this.getTopicCacheKey(preferredTopicId ?? topic?.id ?? 'random', examTarget);

    if (!topic && !explicitTopicName) {
      this.logger.warn(`No topic resolved for AI battle generation (tenant=${tenantId})`);
    }

    try {
      const ai = await this.aiBridgeService.generateQuestionsFromTopic(
        {
          topicId: topic?.id ?? preferredTopicId ?? 'unknown',
          topicName: enrichedTopicName,
          count: safeCount,
          difficulty: examTarget === ExamTarget.JEE ? 'hard' : 'medium',
          type: 'mcq_single',
        },
        tenantId,
      );

      const normalized = this.normalizeAiQuestions(ai, safeCount);

      if (normalized.length >= 3) {
        // Cache successful results for reuse as backup in future battles
        this.saveToTopicCache(cacheKey, normalized);
        return normalized;
      }

      this.logger.warn(
        `AI battle generation returned too few valid questions (${normalized.length}); checking topic cache`,
      );
    } catch (err: any) {
      this.logger.warn(`AI battle generation failed: ${err?.message ?? 'unknown error'}; checking topic cache`);
    }

    // Use topic-level cache as first fallback (same topic+exam from a prior battle)
    const cached = this.getFromTopicCache(cacheKey);
    if (cached) {
      this.logger.log(`Using topic cache for ${enrichedTopicName} (${cached.length} questions)`);
      return cached;
    }

    // Final fallback: DB questions (use resolved topic id or the preferred id from caller)
    return this.getFallbackDbQuestions(tenantId, safeCount, topic?.id ?? preferredTopicId ?? undefined);
  }

  private async getFallbackDbQuestions(
    tenantId: string,
    count: number,
    preferredTopicId?: string,
  ): Promise<AiBattleQuestion[]> {
    const baseWhere = 'q.tenantId = :tenantId AND q.isActive = true';

    const buildQb = (topicId?: string) => {
      const qb = this.questionRepo
        .createQueryBuilder('q')
        .leftJoinAndSelect('q.options', 'options')
        .where(baseWhere, { tenantId });
      if (topicId) qb.andWhere('q.topicId = :topicId', { topicId });
      return qb.orderBy('RANDOM()').limit(count);
    };

    let dbQuestions = preferredTopicId
      ? await buildQb(preferredTopicId).getMany()
      : [];

    // If no topic-specific questions found, fall back to whole curriculum
    if (dbQuestions.length === 0) {
      dbQuestions = await buildQb().getMany();
    }

    return dbQuestions
      .map((q, idx) => {
        const options = (q.options ?? [])
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((o, oIndex) => ({
            id: String.fromCharCode(65 + oIndex),
            text: o.content,
            isCorrect: Boolean(o.isCorrect),
          }));

        if (!q.content || options.length < 2 || !options.some((o) => o.isCorrect)) return null;

        return {
          id: `db_${idx + 1}_${Math.random().toString(36).slice(2, 7)}`,
          text: q.content,
          options,
        } as AiBattleQuestion;
      })
      .filter((q): q is AiBattleQuestion => Boolean(q));
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
