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
import { Question } from '../../database/entities/question.entity';
import { Student } from '../../database/entities/student.entity';

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
    private readonly dataSource: DataSource,
  ) {}

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

  // ─── Helper: format room response ─────────────────────────────────────────

  private async formatRoom(battle: Battle, tenantId: string) {
    const participants = await this.participantRepo.find({
      where: { battleId: battle.id },
      relations: ['student', 'student.user'],
    });
    return {
      battleId: battle.id,
      roomCode: battle.roomCode,
      status: battle.status,
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

  async createBattleRoom(userId: string, tenantId: string, mode = BattleMode.QUICK_DUEL, topicId?: string) {
    const student = await this.getStudent(userId);
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

    // Fetch questions
    let questions: Question[] = [];
    if (topicId) {
      questions = await this.questionRepo
        .createQueryBuilder('q')
        .where('q.topicId = :topicId AND q.tenantId = :tenantId AND q.isActive = true', { topicId, tenantId })
        .orderBy('RANDOM()')
        .limit(qCount)
        .getMany();
    } else {
      questions = await this.questionRepo
        .createQueryBuilder('q')
        .where('q.tenantId = :tenantId AND q.isActive = true', { tenantId })
        .orderBy('RANDOM()')
        .limit(qCount)
        .getMany();
    }

    battle.questionIds = questions.map(q => q.id);
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

  // ─── Join Battle (HTTP) ───────────────────────────────────────────────────

  async joinBattleByCode(roomCode: string, userId: string, tenantId: string) {
    const student = await this.getStudent(userId);
    const battle = await this.battleRepo.findOne({ where: { roomCode, tenantId } });
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
      relations: ['battle', 'battle.topic'],
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
        topicName: (p.battle as any).topic?.name ?? null,
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
      tier: elo.tier,
      battleXp: elo.battleXp,
      battlesPlayed: elo.battlesPlayed,
      battlesWon: elo.battlesWon,
      winStreak: elo.winStreak,
    };
  }

  // ─── Get Daily Battle ─────────────────────────────────────────────────────

  async getDailyBattle(tenantId: string) {
    const battle = await this.battleRepo.findOne({
      where: { tenantId, mode: BattleMode.DAILY },
      relations: ['topic'],
      order: { createdAt: 'DESC' },
    });
    if (!battle) return null;
    return {
      battleId: battle.id,
      roomCode: battle.roomCode,
      status: battle.status,
      topicName: (battle as any).topic?.name ?? null,
      scheduledAt: battle.scheduledAt,
    };
  }

  // ─── Get Questions for a Battle ───────────────────────────────────────────

  async getBattleQuestions(battleId: string) {
    const battle = await this.battleRepo.findOne({ where: { id: battleId } });
    if (!battle?.questionIds?.length) return [];
    const questions = await this.questionRepo.find({
      where: battle.questionIds.map(id => ({ id })),
      relations: ['options'],
    });
    // Return in original order, strip isCorrect from options (anti-cheat)
    return battle.questionIds.map(id => {
      const q = questions.find(q => q.id === id);
      if (!q) return null;
      return {
        id: q.id,
        text: q.content,
        options: q.options.map(o => ({ id: o.id, text: o.content })),
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

    const question = await this.questionRepo.findOne({
      where: { id: data.questionId },
      relations: ['options'],
    });
    const correctOption = question?.options.find(o => o.isCorrect);
    const isCorrect = correctOption?.id === data.optionId;

    await this.answerRepo.save(
      this.answerRepo.create({
        battleId: data.battleId,
        participantId: participant.id,
        questionId: data.questionId,
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
        correctOptionId: correctOption?.id ?? null,
        scores,
        nextQuestion,
      };
    }

    return { roundComplete: false };
  }

  // ─── Finish Battle ────────────────────────────────────────────────────────

  async finishBattle(battleId: string) {
    const participants = await this.participantRepo.find({ where: { battleId } });
    const winner = participants.sort((a, b) => b.roundsWon - a.roundsWon)[0];

    await this.battleRepo.update(battleId, {
      status: BattleStatus.FINISHED,
      winnerId: winner?.studentId,
      endedAt: new Date(),
    });

    const K = 32;
    for (const p of participants) {
      const isWinner = p.studentId === winner?.studentId;
      const opponent = participants.find(op => op.studentId !== p.studentId);
      const expected = 1 / (1 + Math.pow(10, ((opponent?.eloBefore || 1000) - p.eloBefore) / 400));
      const actual = isWinner ? 1 : 0;
      const newElo = Math.round(p.eloBefore + K * (actual - expected));
      const eloChange = newElo - p.eloBefore;
      const xpEarned = isWinner ? 50 : 20;

      await this.participantRepo.update(p.id, { eloAfter: newElo, eloChange, xpEarned });

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
            this.eloRepo.create({ studentId: p.studentId, eloRating: newElo, tier: this.getEloTier(newElo), battleXp: xpEarned }),
          ),
        );
    }

    const finalParticipants = await this.participantRepo.find({
      where: { battleId },
      relations: ['student', 'student.user'],
    });

    return {
      winnerId: winner?.studentId,
      finalScores: finalParticipants.map(p => ({
        studentId: p.studentId,
        name: (p.student as any)?.user?.fullName ?? 'Player',
        roundsWon: p.roundsWon,
        eloChange: p.eloChange ?? 0,
        xpEarned: p.xpEarned ?? 0,
        newElo: p.eloAfter ?? p.eloBefore,
      })),
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

  // ─── Get battle questions by roomCode (for gateway) ──────────────────────

  async getBattleQuestionsByRoom(roomCode: string) {
    const battle = await this.battleRepo.findOne({ where: { roomCode } });
    if (!battle) return [];
    return this.getBattleQuestions(battle.id);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private generateRoomCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
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
