import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, DataSource } from 'typeorm';
import { Readable } from 'stream';
import * as csvParser from 'csv-parser';

import { Question, QuestionOption, QuestionSource, QuestionType, DifficultyLevel } from '../../database/entities/question.entity';
import { Topic } from '../../database/entities/subject.entity';
import { Subject } from '../../database/entities/subject.entity';
import { Chapter } from '../../database/entities/subject.entity';
import { Student } from '../../database/entities/student.entity';
import { PYQAttempt, PYQYearStats } from '../../database/entities/pyq.entity';
import { AiBridgeService } from '../ai-bridge/ai-bridge.service';
import {
  EXAM_LABELS, ExamType,
  GenerateAIPYQDto, GenerateChapterPYQDto, PYQFilterDto,
  StartPYQSessionDto, SubmitPYQAnswerDto, UnverifiedQueryDto, VerifyPYQDto,
} from './dto/pyq.dto';

const PYQ_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

@Injectable()
export class PYQService {
  private readonly logger = new Logger(PYQService.name);

  constructor(
    @InjectRepository(Question)       private readonly questionRepo: Repository<Question>,
    @InjectRepository(QuestionOption) private readonly optionRepo: Repository<QuestionOption>,
    @InjectRepository(Topic)          private readonly topicRepo: Repository<Topic>,
    @InjectRepository(Subject)        private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Chapter)        private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(Student)        private readonly studentRepo: Repository<Student>,
    @InjectRepository(PYQAttempt)     private readonly attemptRepo: Repository<PYQAttempt>,
    @InjectRepository(PYQYearStats)   private readonly statsRepo: Repository<PYQYearStats>,
    private readonly aiBridgeService: AiBridgeService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN — CSV IMPORT
  // ══════════════════════════════════════════════════════════════════════════

  async importCSV(fileBuffer: Buffer, tenantId: string) {
    const rows = await this.parseCSV(fileBuffer);
    const errors: { row: number; error: string }[] = [];
    const toInsert: Array<{ q: Partial<Question>; options: Partial<QuestionOption>[] }> = [];
    const topicsAffected = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1-based + header row
      try {
        const topicId = await this.resolveTopicId(
          row['subject'] ?? '', row['chapter'] ?? '', row['topic'] ?? '', tenantId,
        );
        if (!topicId) {
          errors.push({ row: rowNum, error: `Topic not found: "${row['topic']}" in chapter "${row['chapter']}"` });
          continue;
        }

        const year = parseInt(row['year'], 10);
        const exam = (row['exam'] ?? '').toLowerCase().trim();
        if (isNaN(year) || year < 2000 || year > 2030) {
          errors.push({ row: rowNum, error: `Invalid year: ${row['year']}` });
          continue;
        }

        const type = (row['type'] ?? 'mcq_single').toLowerCase().trim() as QuestionType;
        const questionText = (row['question_text'] ?? '').trim();
        if (!questionText) {
          errors.push({ row: rowNum, error: 'Empty question_text' });
          continue;
        }

        const options = this.buildOptions(row, type);
        const q: Partial<Question> = {
          tenantId,
          topicId,
          content: questionText,
          type: type === 'integer' ? QuestionType.INTEGER : QuestionType.MCQ_SINGLE,
          difficulty: this.mapDifficulty(row['difficulty']),
          source: QuestionSource.PYQ,
          pyqYear: year,
          pyqPaper: row['exam'] ?? '',
          pyqExam: exam,
          pyqShift: row['shift'] || null,
          marksCorrect: parseFloat(row['marks'] ?? '4') || 4,
          marksWrong: parseFloat(row['negative'] ?? '1') || 1,
          solutionText: row['explanation'] ?? null,
          isVerified: true,
          isGlobal: true,
          isActive: true,
        };

        if (type === 'integer') {
          q.integerAnswer = (row['correct'] ?? '').trim();
        }

        toInsert.push({ q, options });
        topicsAffected.add(topicId);
      } catch (err) {
        errors.push({ row: rowNum, error: String(err?.message ?? err) });
      }
    }

    // Batch insert — skip exact duplicates (same topicId + year + exam + content)
    let imported = 0;
    let skipped = 0;
    for (const { q, options } of toInsert) {
      try {
        const existing = await this.questionRepo.findOne({
          where: {
            topicId: q.topicId,
            pyqYear: q.pyqYear,
            pyqExam: q.pyqExam,
            content: q.content,
          },
        });
        if (existing) { skipped++; continue; }

        const saved = await this.questionRepo.save(this.questionRepo.create(q as Question));
        if (options.length) {
          await this.optionRepo.save(
            options.map(o => this.optionRepo.create({ ...o, questionId: saved.id } as QuestionOption)),
          );
        }
        imported++;
      } catch {
        skipped++;
      }
    }

    // Recompute stats for all affected topics
    for (const topicId of topicsAffected) {
      await this.recomputePYQStats(topicId);
    }

    return {
      totalRows: rows.length,
      imported,
      skipped,
      errors,
      topicsUpdated: [...topicsAffected],
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN — AI GENERATION
  // ══════════════════════════════════════════════════════════════════════════

  async generateAIForTopic(dto: GenerateAIPYQDto, tenantId: string) {
    const topic = await this.topicRepo.findOne({
      where: { id: dto.topicId },
      relations: ['chapter', 'chapter.subject'],
    });
    if (!topic) throw new NotFoundException(`Topic ${dto.topicId} not found`);

    const chapterName = (topic as any).chapter?.name ?? '';
    const subjectName = (topic as any).chapter?.subject?.name ?? '';

    const results: Record<string, number> = {};
    let totalGenerated = 0;

    for (const exam of dto.exams) {
      try {
        const questions = await this.generatePYQsViaAI(
          topic.name, chapterName, subjectName, exam, dto.startYear, dto.endYear, tenantId,
        );
        const saved = await this.savePYQQuestions(questions, dto.topicId, exam, tenantId, false);
        results[exam] = saved;
        totalGenerated += saved;
      } catch (err) {
        this.logger.error(`AI PYQ generation failed for ${exam}: ${err.message}`);
        results[exam] = 0;
      }
    }

    await this.recomputePYQStats(dto.topicId);

    return {
      topicId: dto.topicId,
      topicName: topic.name,
      generated: results,
      totalGenerated,
      requiresReview: true,
    };
  }

  async generateAIForChapter(dto: GenerateChapterPYQDto, tenantId: string) {
    const chapter = await this.chapterRepo.findOne({
      where: { id: dto.chapterId },
      relations: ['subject'],
    });
    if (!chapter) throw new NotFoundException(`Chapter ${dto.chapterId} not found`);

    const topics = await this.topicRepo.find({ where: { chapterId: dto.chapterId } });
    const topicResults: Array<{ topicName: string; count: number }> = [];
    let totalGenerated = 0;

    for (const topic of topics) {
      try {
        const subjectName = (chapter as any).subject?.name ?? '';
        let count = 0;
        for (const exam of dto.exams) {
          const questions = await this.generatePYQsViaAI(
            topic.name, chapter.name, subjectName, exam, dto.startYear, dto.endYear, tenantId,
          );
          count += await this.savePYQQuestions(questions, topic.id, exam, tenantId, false);
        }
        await this.recomputePYQStats(topic.id);
        topicResults.push({ topicName: topic.name, count });
        totalGenerated += count;
      } catch (err) {
        this.logger.error(`Chapter AI gen failed for topic ${topic.name}: ${err.message}`);
        topicResults.push({ topicName: topic.name, count: 0 });
      }
    }

    return {
      chapterId: dto.chapterId,
      chapterName: chapter.name,
      topicsProcessed: topics.length,
      totalQuestionsGenerated: totalGenerated,
      topicResults,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN — REVIEW / VERIFY
  // ══════════════════════════════════════════════════════════════════════════

  async getUnverifiedPYQs(query: UnverifiedQueryDto, tenantId: string) {
    const qb = this.questionRepo.createQueryBuilder('q')
      .leftJoinAndSelect('q.options', 'o')
      .leftJoinAndSelect('q.topic', 't')
      .leftJoinAndSelect('t.chapter', 'ch')
      .leftJoinAndSelect('ch.subject', 's')
      .where('q.source = :src', { src: QuestionSource.PYQ })
      .andWhere('q.is_verified = false')
      .andWhere('(q.is_global = true OR q.tenant_id = :tenantId)', { tenantId })
      .orderBy('q.createdAt', 'DESC');

    if (query.topicId)   qb.andWhere('q.topic_id = :topicId', { topicId: query.topicId });
    if (query.exam)      qb.andWhere('q.pyq_exam = :exam', { exam: query.exam });
    if (query.subjectId) qb.andWhere('s.id = :subjectId', { subjectId: query.subjectId });

    const page  = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, query.limit ?? 20);
    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();
    return {
      total, page, limit,
      questions: items.map(q => ({
        id:               q.id,
        content:          q.content,
        questionImageUrl: q.contentImageUrl ?? null,
        type:             q.type,
        difficulty:       q.difficulty,
        pyqYear:          q.pyqYear,
        pyqExam:          q.pyqExam,
        pyqExamLabel:     EXAM_LABELS[q.pyqExam ?? ''] ?? (q.pyqExam ?? ''),
        solutionText:     q.solutionText ?? null,
        marks:            q.marksCorrect,
        negativeMarks:    Math.abs(q.marksWrong),
        topic:            q.topic ? { id: q.topic.id, name: q.topic.name } : null,
        options:          (q.options ?? [])
                            .sort((a, b) => a.sortOrder - b.sortOrder)
                            .map(o => ({
                              optionLabel: o.optionLabel,
                              content:     o.content,
                              isCorrect:   o.isCorrect,
                            })),
        createdAt: q.createdAt,
      })),
    };
  }

  async verifyQuestion(questionId: string, dto: VerifyPYQDto, tenantId: string) {
    const q = await this.questionRepo.findOne({
      where: { id: questionId },
      relations: ['options'],
    });
    if (!q) throw new NotFoundException('Question not found');

    q.isVerified = dto.isVerified;
    if (dto.correctedContent)     q.content = dto.correctedContent;
    if (dto.correctedExplanation) q.solutionText = dto.correctedExplanation;

    if (dto.correctedOptions && dto.correctedOptions.length) {
      await this.optionRepo.delete({ questionId });
      await this.optionRepo.save(
        dto.correctedOptions.map((o, i) =>
          this.optionRepo.create({
            questionId,
            optionLabel: String.fromCharCode(65 + i),
            content: o.text,
            isCorrect: (dto.correctedCorrectOptionIds ?? []).includes(o.id),
            sortOrder: i,
          }),
        ),
      );
    } else if (dto.correctedCorrectOptionIds?.length) {
      // Only correct the answer flags
      const opts = await this.optionRepo.find({ where: { questionId } });
      for (const opt of opts) {
        opt.isCorrect = dto.correctedCorrectOptionIds.includes(opt.optionLabel.toLowerCase());
        await this.optionRepo.save(opt);
      }
    }

    const saved = await this.questionRepo.save(q);
    if (dto.isVerified) await this.recomputePYQStats(q.topicId);
    return { id: saved.id, isVerified: saved.isVerified };
  }

  async rejectQuestion(questionId: string, tenantId: string) {
    const q = await this.questionRepo.findOne({ where: { id: questionId } });
    if (!q) throw new NotFoundException('Question not found');
    if (q.isVerified) throw new BadRequestException('Cannot reject a verified question');
    await this.questionRepo.remove(q);
    return { message: 'Question deleted' };
  }

  async getPYQStats(tenantId: string) {
    const rows = await this.questionRepo
      .createQueryBuilder('q')
      .leftJoin('q.topic', 't')
      .leftJoin('t.chapter', 'ch')
      .leftJoin('ch.subject', 's')
      .select('q.pyq_exam', 'exam')
      .addSelect('s.name', 'subject')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN q.is_verified THEN 1 ELSE 0 END)', 'verified')
      .where('q.source = :src', { src: QuestionSource.PYQ })
      .andWhere('(q.is_global = true OR q.tenant_id = :tenantId)', { tenantId })
      .groupBy('q.pyq_exam, s.name')
      .orderBy('q.pyq_exam', 'ASC')
      .getRawMany();

    const totalVerified = rows.reduce((s, r) => s + parseInt(r.verified ?? 0), 0);
    const totalUnverified = rows.reduce((s, r) => s + parseInt(r.total ?? 0) - parseInt(r.verified ?? 0), 0);

    return {
      totalVerified,
      totalUnverified,
      byExamAndSubject: rows.map(r => ({
        exam: r.exam,
        examLabel: EXAM_LABELS[r.exam] ?? r.exam,
        subject: r.subject,
        total: parseInt(r.total),
        verified: parseInt(r.verified ?? 0),
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STUDENT — OVERVIEW
  // ══════════════════════════════════════════════════════════════════════════

  async getPYQOverview(topicId: string, userId: string, tenantId: string) {
    const topic = await this.topicRepo.findOne({
      where: { id: topicId },
      relations: ['chapter'],
    });
    if (!topic) throw new NotFoundException('Topic not found');

    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');

    const examFilter = this.getExamFilter(student.examTarget);

    // Year stats from pre-computed table
    const statsRows = await this.statsRepo
      .createQueryBuilder('s')
      .where('s.topic_id = :topicId', { topicId })
      .andWhere('s.pyq_exam IN (:...exams)', { exams: examFilter })
      .getMany();

    // Student attempts on PYQs for this topic
    const attempts = await this.attemptRepo
      .createQueryBuilder('a')
      .innerJoin('questions', 'q', 'q.id = a.question_id AND q.topic_id = :topicId', { topicId })
      .where('a.student_id = :studentId', { studentId: student.id })
      .andWhere('a.tenant_id = :tenantId', { tenantId })
      .select(['a.question_id', 'a.is_correct', 'q.pyq_year'])
      .getRawMany();

    const totalQuestions = statsRows.reduce((s, r) => s + r.questionCount, 0);
    const yearsAvailable = [...new Set(statsRows.map(r => r.pyqYear))].sort();
    const examsAvailable = [...new Set(statsRows.map(r => r.pyqExam))];
    const studentAttempted = attempts.length;
    const studentCorrect = attempts.filter(a => a.a_is_correct).length;

    // Build year breakdown
    const yearBreakdownMap: Record<number, Record<string, any>> = {};
    for (const year of PYQ_YEARS) {
      yearBreakdownMap[year] = { year };
      for (const exam of examFilter) {
        const stat = statsRows.find(r => r.pyqYear === year && r.pyqExam === exam);
        yearBreakdownMap[year][exam] = stat
          ? { count: stat.questionCount, difficulty: { easy: stat.easyCount, medium: stat.mediumCount, hard: stat.hardCount } }
          : { count: 0, difficulty: { easy: 0, medium: 0, hard: 0 } };
      }
    }

    // Student progress by year
    const byYear: Record<string, { attempted: number; correct: number }> = {};
    for (const a of attempts) {
      const y = String(a.q_pyq_year ?? a['q.pyq_year']);
      if (!byYear[y]) byYear[y] = { attempted: 0, correct: 0 };
      byYear[y].attempted++;
      if (a.a_is_correct) byYear[y].correct++;
    }

    return {
      topicId,
      topicName: topic.name,
      chapterName: (topic as any).chapter?.name ?? '',
      summary: { totalQuestions, yearsAvailable, examsAvailable, studentAttempted, studentCorrect },
      yearBreakdown: Object.values(yearBreakdownMap),
      studentProgress: { byYear },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STUDENT — GET PYQs (filtered)
  // ══════════════════════════════════════════════════════════════════════════

  async getPYQs(topicId: string, userId: string, tenantId: string, filter: PYQFilterDto) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');

    const examFilter = filter.exam ?? this.getExamFilter(student.examTarget);
    const page  = Math.max(1, filter.page ?? 1);
    const limit = Math.min(50, filter.limit ?? 10);

    const qb = this.questionRepo.createQueryBuilder('q')
      .leftJoinAndSelect('q.options', 'o')
      .where('q.topic_id = :topicId', { topicId })
      .andWhere('q.source = :src', { src: QuestionSource.PYQ })
      .andWhere('q.is_verified = true')
      .andWhere('q.is_active = true')
      .andWhere('(q.is_global = true OR q.tenant_id = :tenantId)', { tenantId })
      .orderBy('q.pyqYear', 'DESC')
      .addOrderBy('q.difficulty', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filter.year) qb.andWhere('q.pyq_year = :year', { year: filter.year });
    if (Array.isArray(examFilter)) {
      qb.andWhere('q.pyq_exam IN (:...exams)', { exams: examFilter });
    } else {
      qb.andWhere('q.pyq_exam = :exam', { exam: examFilter });
    }
    if (filter.difficulty) qb.andWhere('q.difficulty = :diff', { diff: filter.difficulty });

    const [questions, total] = await qb.getManyAndCount();

    // Fetch student attempts for these questions
    const questionIds = questions.map(q => q.id);
    const attempts = questionIds.length
      ? await this.attemptRepo.find({
          where: { studentId: student.id, questionId: In(questionIds) },
        })
      : [];
    const attemptMap = new Map(attempts.map(a => [a.questionId, a]));

    // Filter by attempt status if requested
    let filtered = questions;
    if (filter.status === 'attempted')   filtered = questions.filter(q => attemptMap.has(q.id));
    if (filter.status === 'unattempted') filtered = questions.filter(q => !attemptMap.has(q.id));

    return {
      total,
      page,
      questions: filtered.map(q => this.serializeQuestion(q, attemptMap.get(q.id) ?? null)),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STUDENT — SUBMIT ANSWER
  // ══════════════════════════════════════════════════════════════════════════

  async submitPYQAnswer(topicId: string, questionId: string, userId: string, tenantId: string, dto: SubmitPYQAnswerDto) {
    const question = await this.questionRepo.findOne({
      where: { id: questionId, topicId, source: QuestionSource.PYQ, isVerified: true },
      relations: ['options'],
    });
    if (!question) throw new NotFoundException('PYQ question not found');

    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');

    // Check if first attempt
    const existing = await this.attemptRepo.findOne({
      where: { studentId: student.id, questionId },
    });
    const isFirstAttempt = !existing;

    // Grade
    let isCorrect = false;
    if (question.type === QuestionType.INTEGER) {
      isCorrect = (dto.integerResponse ?? '').trim() === (question.integerAnswer ?? '').trim();
    } else {
      const correctIds = question.options
        .filter(o => o.isCorrect)
        .map(o => o.optionLabel.toLowerCase());
      const submitted = (dto.selectedOptionIds ?? []).map(s => s.toLowerCase()).sort();
      isCorrect = JSON.stringify(correctIds.sort()) === JSON.stringify(submitted);
    }

    // XP: only on first correct attempt
    let xpAwarded = 0;
    if (isCorrect && isFirstAttempt) {
      xpAwarded = Math.round(question.marksCorrect);
      student.xpTotal = (student.xpTotal ?? 0) + xpAwarded;
      await this.studentRepo.save(student);
    }

    // Upsert attempt
    if (existing) {
      existing.selectedOptionIds = dto.selectedOptionIds ?? [];
      existing.integerResponse = dto.integerResponse ?? null;
      existing.isCorrect = isCorrect;
      existing.timeTakenSeconds = dto.timeTakenSeconds ?? 0;
      // xpAwarded stays as original (no re-earning)
      await this.attemptRepo.save(existing);
    } else {
      await this.attemptRepo.save(
        this.attemptRepo.create({
          tenantId,
          studentId: student.id,
          questionId,
          selectedOptionIds: dto.selectedOptionIds ?? [],
          integerResponse: dto.integerResponse ?? null,
          isCorrect,
          timeTakenSeconds: dto.timeTakenSeconds ?? 0,
          xpAwarded,
        }),
      );
    }

    // Update question stats
    await this.questionRepo.increment({ id: questionId }, 'viewCount', 1);
    if (isCorrect) {
      await this.questionRepo.increment({ id: questionId }, 'correctAttemptCount', 1);
    } else {
      await this.questionRepo.increment({ id: questionId }, 'wrongAttemptCount', 1);
    }

    // Build response with revealed correct answer
    const correctOptionIds = question.options.filter(o => o.isCorrect).map(o => o.optionLabel.toLowerCase());
    const total = (question.correctAttemptCount ?? 0) + (question.wrongAttemptCount ?? 0) + 1;
    const correctPct = total > 0
      ? Math.round(((question.correctAttemptCount ?? 0) + (isCorrect ? 1 : 0)) / total * 100)
      : 0;

    return {
      questionId,
      isCorrect,
      correctOptionIds,
      correctIntegerAnswer: question.type === QuestionType.INTEGER ? question.integerAnswer : null,
      explanation: question.solutionText ?? '',
      xpAwarded,
      studentTotalXp: student.xpTotal ?? 0,
      globalStats: {
        correctAttemptPct: correctPct,
        difficultyLabel: `This is a ${question.difficulty} question`,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STUDENT — START SESSION (filtered batch)
  // ══════════════════════════════════════════════════════════════════════════

  async startPYQSession(topicId: string, userId: string, tenantId: string, dto: StartPYQSessionDto) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');

    const limit = Math.min(200, dto.limit ?? 200);

    // Get student's enrolled batch IDs for scoping
    const enrollments = await this.dataSource.query(
      `SELECT batch_id FROM enrollments WHERE student_id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [student.id],
    );
    const batchIds: string[] = enrollments.map((e: any) => e.batch_id);
    const primaryBatchId: string | null = batchIds[0] ?? null;

    // Reusable query builder factory — same filters applied each time
    const buildQb = () => {
      const qb = this.questionRepo.createQueryBuilder('q')
        .leftJoinAndSelect('q.options', 'o')
        .where('q.topic_id = :topicId', { topicId })
        .andWhere('q.source = :src', { src: QuestionSource.PYQ })
        .andWhere('q.is_verified = true')
        .andWhere('q.is_active = true');

      if (batchIds.length > 0) {
        // Questions visible to this student: global real PYQs OR scoped to their batch
        qb.andWhere('(q.is_global = true OR q.batch_id IN (:...batchIds))', { batchIds });
      } else {
        qb.andWhere('(q.is_global = true OR q.tenant_id = :tenantId)', { tenantId });
      }

      if (dto.year) {
        qb.andWhere('q.pyq_year = :year', { year: dto.year });
      } else {
        if (dto.startYear) qb.andWhere('q.pyq_year >= :startYear', { startYear: dto.startYear });
        if (dto.endYear)   qb.andWhere('q.pyq_year <= :endYear',   { endYear: dto.endYear });
      }
      if (dto.exam) qb.andWhere('q.pyq_exam = :exam', { exam: dto.exam });
      if (dto.difficulty) qb.andWhere('q.difficulty = :diff', { diff: dto.difficulty });
      return qb;
    };

    let allQuestions = await buildQb().take(200).getMany();

    // Auto-generate via AI when no questions exist for this batch + filters
    if (allQuestions.length === 0) {
      const topic = await this.topicRepo.findOne({
        where: { id: topicId },
        relations: ['chapter', 'chapter.subject'],
      });
      if (topic) {
        const chapterName = (topic as any).chapter?.name ?? '';
        const subjectName = (topic as any).chapter?.subject?.name ?? '';
        const startY = dto.startYear ?? dto.year ?? 2020;
        const endY   = dto.endYear   ?? dto.year ?? new Date().getFullYear();
        const examsToGen: ExamType[] = dto.exam
          ? [dto.exam as ExamType]
          : (['jee_mains', 'jee_advanced', 'neet'] as ExamType[]);

        for (const exam of examsToGen) {
          try {
            const generated = await this.generatePYQsViaAI(
              topic.name, chapterName, subjectName, exam, startY, endY, tenantId,
            );
            if (generated.length > 0) {
              // Save scoped to the student's batch (not global)
              await this.savePYQQuestions(generated, topicId, exam, tenantId, true, primaryBatchId);
            }
          } catch (err) {
            this.logger.warn(`Auto-gen PYQ failed for ${exam}: ${err.message}`);
          }
        }
        await this.recomputePYQStats(topicId);
        allQuestions = await buildQb().take(200).getMany();
      }
    }

    // Prioritize unattempted, then wrong, then correct
    const attempted = await this.attemptRepo.find({
      where: { studentId: student.id },
      select: ['questionId', 'isCorrect'],
    });
    const attemptedCorrectIds = new Set(attempted.filter(a => a.isCorrect).map(a => a.questionId));
    const attemptedWrongIds   = new Set(attempted.filter(a => !a.isCorrect).map(a => a.questionId));

    const unattempted = allQuestions.filter(q => !attemptedCorrectIds.has(q.id) && !attemptedWrongIds.has(q.id));
    const wrong       = allQuestions.filter(q => attemptedWrongIds.has(q.id));
    const correct     = allQuestions.filter(q => attemptedCorrectIds.has(q.id));
    const ordered     = [...unattempted, ...wrong, ...correct].slice(0, limit);

    const attemptMap = new Map(attempted.map(a => [a.questionId, a]));

    return {
      sessionRef: ordered.length > 0 ? require('crypto').randomUUID() : null,
      questions: ordered.map(q => this.serializeQuestion(q, attemptMap.get(q.id) ?? null)),
      totalInSession: ordered.length,
      filterApplied: {
        year: dto.year ?? null,
        startYear: dto.startYear ?? null,
        endYear: dto.endYear ?? null,
        exam: dto.exam ?? 'all',
        difficulty: dto.difficulty ?? 'all',
      },
      alternatives: [],
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STUDENT — MY PROGRESS
  // ══════════════════════════════════════════════════════════════════════════

  async getMyProgress(topicId: string, userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');

    const attempts = await this.attemptRepo
      .createQueryBuilder('a')
      .innerJoin('questions', 'q', 'q.id = a.question_id AND q.topic_id = :topicId', { topicId })
      .where('a.student_id = :studentId', { studentId: student.id })
      .select([
        'a.question_id AS question_id',
        'a.is_correct  AS is_correct',
        'a.xp_awarded  AS xp_awarded',
        'q.pyq_year    AS pyq_year',
        'q.pyq_exam    AS pyq_exam',
        'q.difficulty  AS difficulty',
        'q.content     AS content',
      ])
      .getRawMany();

    const totalAttempted = attempts.length;
    const totalCorrect   = attempts.filter(a => a.is_correct).length;
    const accuracyPct    = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
    const xpEarned       = attempts.reduce((s, a) => s + (parseInt(a.xp_awarded) || 0), 0);

    // By year
    const byYearMap: Record<string, { attempted: number; correct: number }> = {};
    for (const a of attempts) {
      const y = String(a.pyq_year);
      if (!byYearMap[y]) byYearMap[y] = { attempted: 0, correct: 0 };
      byYearMap[y].attempted++;
      if (a.is_correct) byYearMap[y].correct++;
    }
    const byYear = Object.entries(byYearMap)
      .map(([year, d]) => ({ year: parseInt(year), ...d, accuracy: d.attempted > 0 ? Math.round(d.correct / d.attempted * 100) : 0 }))
      .sort((a, b) => b.year - a.year);

    // By difficulty
    const byDifficultyMap: Record<string, { attempted: number; correct: number }> = {
      easy: { attempted: 0, correct: 0 },
      medium: { attempted: 0, correct: 0 },
      hard: { attempted: 0, correct: 0 },
    };
    for (const a of attempts) {
      const d = a.difficulty ?? 'medium';
      if (!byDifficultyMap[d]) byDifficultyMap[d] = { attempted: 0, correct: 0 };
      byDifficultyMap[d].attempted++;
      if (a.is_correct) byDifficultyMap[d].correct++;
    }
    const byDifficulty: Record<string, any> = {};
    for (const [key, val] of Object.entries(byDifficultyMap)) {
      byDifficulty[key] = { ...val, accuracy: val.attempted > 0 ? Math.round(val.correct / val.attempted * 100) : 0 };
    }

    // By exam
    const byExamMap: Record<string, { attempted: number; correct: number }> = {};
    for (const a of attempts) {
      const e = a.pyq_exam ?? 'unknown';
      if (!byExamMap[e]) byExamMap[e] = { attempted: 0, correct: 0 };
      byExamMap[e].attempted++;
      if (a.is_correct) byExamMap[e].correct++;
    }

    // Wrong questions
    const wrongQuestions = attempts
      .filter(a => !a.is_correct)
      .map(a => ({
        questionId: a.question_id,
        questionPreview: (a.content ?? '').substring(0, 100),
        pyqYear: a.pyq_year,
        pyqExam: a.pyq_exam,
        difficulty: a.difficulty,
      }));

    return { totalAttempted, totalCorrect, accuracyPct, xpEarned, byYear, byDifficulty, byExam: byExamMap, wrongQuestions };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STUDENT — CHAPTER OVERVIEW
  // ══════════════════════════════════════════════════════════════════════════

  async getChapterPYQOverview(chapterId: string, userId: string, tenantId: string) {
    const chapter = await this.chapterRepo.findOne({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException('Chapter not found');

    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');

    const topics = await this.topicRepo.find({ where: { chapterId } });
    const topicIds = topics.map(t => t.id);

    // Total PYQs per topic from stats table
    const stats = topicIds.length
      ? await this.statsRepo
          .createQueryBuilder('s')
          .where('s.topic_id IN (:...topicIds)', { topicIds })
          .select(['s.topic_id AS topic_id', 'SUM(s.question_count) AS total'])
          .groupBy('s.topic_id')
          .getRawMany()
      : [];
    const statsMap = new Map(stats.map(s => [s.topic_id, parseInt(s.total)]));

    // Student attempts per topic
    const attempts = topicIds.length
      ? await this.attemptRepo
          .createQueryBuilder('a')
          .innerJoin('questions', 'q', 'q.id = a.question_id AND q.topic_id IN (:...topicIds)', { topicIds })
          .where('a.student_id = :studentId', { studentId: student.id })
          .select([
            'q.topic_id AS topic_id',
            'COUNT(*)   AS attempted',
            'SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) AS correct',
            'MAX(a.attempted_at) AS last_at',
          ])
          .groupBy('q.topic_id')
          .getRawMany()
      : [];
    const attMap = new Map(attempts.map(a => [a.topic_id, a]));

    const topicData = topics.map(t => {
      const att = attMap.get(t.id);
      return {
        topicId: t.id,
        topicName: t.name,
        totalPYQs: statsMap.get(t.id) ?? 0,
        studentAttempted: att ? parseInt(att.attempted) : 0,
        studentCorrect:   att ? parseInt(att.correct)   : 0,
        lastAttemptedAt:  att ? att.last_at : null,
      };
    });

    const totalPYQs = topicData.reduce((s, t) => s + t.totalPYQs, 0);
    const studentAttempted = topicData.reduce((s, t) => s + t.studentAttempted, 0);
    const studentCorrect   = topicData.reduce((s, t) => s + t.studentCorrect, 0);

    return {
      chapterId,
      chapterName: chapter.name,
      totalPYQs,
      studentAttempted,
      studentAccuracy: studentAttempted > 0 ? Math.round(studentCorrect / studentAttempted * 100) : 0,
      topics: topicData,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATS RECOMPUTATION
  // ══════════════════════════════════════════════════════════════════════════

  async recomputePYQStats(topicId: string): Promise<void> {
    try {
      const rows = await this.questionRepo
        .createQueryBuilder('q')
        .select('q.pyq_exam', 'exam')
        .addSelect('q.pyq_year', 'year')
        .addSelect('COUNT(*)', 'total')
        .addSelect(`SUM(CASE WHEN q.difficulty = 'easy'   THEN 1 ELSE 0 END)`, 'easy')
        .addSelect(`SUM(CASE WHEN q.difficulty = 'medium' THEN 1 ELSE 0 END)`, 'medium')
        .addSelect(`SUM(CASE WHEN q.difficulty = 'hard'   THEN 1 ELSE 0 END)`, 'hard')
        .where('q.topic_id = :topicId', { topicId })
        .andWhere('q.source = :src', { src: QuestionSource.PYQ })
        .andWhere('q.is_verified = true')
        .andWhere('q.deleted_at IS NULL')
        .groupBy('q.pyq_exam, q.pyq_year')
        .getRawMany();

      for (const stat of rows) {
        if (!stat.exam || !stat.year) continue;
        await this.statsRepo
          .createQueryBuilder()
          .insert()
          .into(PYQYearStats)
          .values({
            topicId,
            pyqExam: stat.exam,
            pyqYear: parseInt(stat.year),
            questionCount: parseInt(stat.total),
            easyCount:     parseInt(stat.easy   ?? 0),
            mediumCount:   parseInt(stat.medium ?? 0),
            hardCount:     parseInt(stat.hard   ?? 0),
            updatedAt: new Date(),
          })
          .orUpdate(
            ['question_count', 'easy_count', 'medium_count', 'hard_count', 'updated_at'],
            ['topic_id', 'pyq_exam', 'pyq_year'],
          )
          .execute();
      }
    } catch (err) {
      this.logger.error(`recomputePYQStats failed for ${topicId}: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private async generatePYQsViaAI(
    topicName: string, chapterName: string, subjectName: string,
    exam: ExamType, startYear: number, endYear: number, tenantId: string,
  ): Promise<any[]> {
    const examLabel = EXAM_LABELS[exam] ?? exam;
    const prompt = `Generate realistic Previous Year Questions for:
Topic: ${topicName}
Chapter: ${chapterName}
Subject: ${subjectName}
Exam: ${examLabel}
Years: ${startYear} to ${endYear}

Generate 2-3 MCQ questions per year for this topic from this exam.
Make them realistic. Vary difficulty (easy/medium/hard).
JEE Advanced questions must be significantly harder. NEET focuses on concepts.

Return ONLY a valid JSON array, no markdown:
[{"year":2023,"questionText":"full text","type":"mcq_single","options":[{"id":"a","text":""},{"id":"b","text":""},{"id":"c","text":""},{"id":"d","text":""}],"correctOptionIds":["b"],"difficulty":"medium","marks":4,"negativeMarks":1,"explanation":"step by step reason"}]`;

    const raw = await (this.aiBridgeService as any).post('/test/generate/', {
      topic: `${topicName} (${chapterName}, ${subjectName}) for ${examLabel} ${startYear}-${endYear}`,
      num_questions: (endYear - startYear + 1) * 2,
      difficulty: 'mixed',
      question_types: 'mcq',
      custom_prompt: prompt,
    }, tenantId).catch(() => null);

    if (!raw) {
      // Fallback: try tutor session
      const tutorRes = await (this.aiBridgeService as any).post('/ai/tutor/', {
        studentId: 'system',
        topicId: topicName,
        context: prompt,
      }, tenantId).catch(() => null);

      if (!tutorRes) return [];
      const text = tutorRes?.response ?? JSON.stringify(tutorRes);
      return this.parseAIJsonArray(text);
    }

    if (Array.isArray(raw?.questions)) {
      return raw.questions.map((q: any) => ({
        year: startYear + Math.floor(Math.random() * (endYear - startYear + 1)),
        questionText: q.question || q.content || '',
        type: 'mcq_single',
        options: (q.options || []).map((o: any, i: number) => ({
          id: String.fromCharCode(97 + i),
          text: typeof o === 'string' ? o : o,
        })),
        correctOptionIds: [String.fromCharCode(97 + (q.answer === 'A' ? 0 : q.answer === 'B' ? 1 : q.answer === 'C' ? 2 : 3))],
        difficulty: q.difficulty || 'medium',
        marks: 4,
        negativeMarks: 1,
        explanation: q.explanation || '',
      }));
    }

    return this.parseAIJsonArray(JSON.stringify(raw));
  }

  private parseAIJsonArray(text: string): any[] {
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return [];
      return JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  private async savePYQQuestions(
    questions: any[], topicId: string, exam: string, tenantId: string,
    isVerified: boolean, batchId: string | null = null,
  ): Promise<number> {
    let saved = 0;
    for (const q of questions) {
      try {
        const questionText = q.questionText || q.content || '';
        if (!questionText) continue;
        const year = parseInt(q.year) || 0;
        if (!year) continue;

        // Skip exact duplicate
        const exists = await this.questionRepo.findOne({
          where: { topicId, pyqYear: year, pyqExam: exam, content: questionText },
        });
        if (exists) continue;

        const question = await this.questionRepo.save(
          this.questionRepo.create({
            tenantId,
            topicId,
            content: questionText,
            type: q.type === 'integer' ? QuestionType.INTEGER : QuestionType.MCQ_SINGLE,
            difficulty: this.mapDifficulty(q.difficulty),
            source: QuestionSource.PYQ,
            pyqYear: year,
            pyqExam: exam,
            pyqPaper: EXAM_LABELS[exam] ?? exam,
            marksCorrect: q.marks ?? 4,
            marksWrong: q.negativeMarks ?? 1,
            solutionText: q.explanation ?? null,
            integerAnswer: q.type === 'integer' ? String(q.correctOptionIds?.[0] ?? '') : null,
            isVerified,
            isGlobal: batchId === null,   // global only when no batch scope
            batchId:  batchId ?? null,
            isActive: true,
          } as unknown as Question),
        );

        if (q.options?.length) {
          const opts = q.options.map((o: any, i: number) => {
            const optId = typeof o === 'object' ? (o.id ?? String.fromCharCode(97 + i)) : String.fromCharCode(97 + i);
            const text  = typeof o === 'object' ? (o.text ?? String(o)) : String(o);
            return this.optionRepo.create({
              questionId: question.id,
              optionLabel: String.fromCharCode(65 + i),
              content: text,
              isCorrect: (q.correctOptionIds ?? []).includes(optId),
              sortOrder: i,
            } as QuestionOption);
          });
          await this.optionRepo.save(opts);
        }
        saved++;
      } catch (err) {
        this.logger.warn(`Failed to save PYQ: ${err.message}`);
      }
    }
    return saved;
  }

  private async resolveTopicId(subject: string, chapter: string, topic: string, tenantId: string): Promise<string | null> {
    const row = await this.dataSource.query(`
      SELECT t.id
        FROM topics t
        JOIN chapters c ON t.chapter_id = c.id
        JOIN subjects s ON c.subject_id = s.id
       WHERE LOWER(s.name) = LOWER($1)
         AND LOWER(c.name) = LOWER($2)
         AND LOWER(t.name) = LOWER($3)
         AND (s.tenant_id = $4 OR s.tenant_id IS NULL)
       LIMIT 1
    `, [subject.trim(), chapter.trim(), topic.trim(), tenantId]);
    return row?.[0]?.id ?? null;
  }

  private buildOptions(row: Record<string, string>, type: string) {
    if (type === 'integer') return [];
    const correct = (row['correct'] ?? '').toLowerCase().trim();
    return ['a', 'b', 'c', 'd'].map((label, i) => {
      const text = (row[`option_${label}`] ?? '').trim();
      return {
        optionLabel: label.toUpperCase(),
        content: text,
        isCorrect: correct === label,
        sortOrder: i,
      };
    }).filter(o => o.content);
  }

  private mapDifficulty(raw?: string): DifficultyLevel {
    const v = (raw ?? '').toLowerCase().trim();
    if (v === 'easy') return DifficultyLevel.EASY;
    if (v === 'hard') return DifficultyLevel.HARD;
    return DifficultyLevel.MEDIUM;
  }

  private getExamFilter(examTarget?: string): string[] {
    const t = (examTarget ?? '').toLowerCase();
    if (t === 'neet') return ['neet'];
    if (t === 'jee')  return ['jee_mains', 'jee_advanced'];
    return ['jee_mains', 'jee_advanced', 'neet'];
  }

  private serializeQuestion(q: Question, attempt: PYQAttempt | null) {
    return {
      id: q.id,
      topicId: q.topicId,
      questionText: q.content,
      questionImageUrl: q.contentImageUrl ?? null,
      type: q.type,
      options: (q.options ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(o => ({ id: o.optionLabel.toLowerCase(), text: o.content })),
      difficulty: q.difficulty,
      marks: q.marksCorrect,
      negativeMarks: Math.abs(q.marksWrong),
      pyqYear: q.pyqYear,
      pyqExam: q.pyqExam ?? q.pyqPaper,
      pyqExamLabel: EXAM_LABELS[q.pyqExam ?? ''] ?? (q.pyqPaper ?? ''),
      pyqShift: q.pyqShift ?? null,
      isVerified: q.isVerified,
      studentAttempt: attempt
        ? {
            selectedOptionIds: attempt.selectedOptionIds,
            integerResponse: attempt.integerResponse ?? null,
            isCorrect: attempt.isCorrect,
            xpAwarded: attempt.xpAwarded,
            attemptedAt: attempt.attemptedAt,
          }
        : null,
    };
  }

  private parseCSV(buffer: Buffer): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      const rows: Record<string, string>[] = [];
      const stream = Readable.from(buffer);
      stream
        .pipe(csvParser())
        .on('data', (row: Record<string, string>) => rows.push(row))
        .on('end', () => resolve(rows))
        .on('error', reject);
    });
  }
}
