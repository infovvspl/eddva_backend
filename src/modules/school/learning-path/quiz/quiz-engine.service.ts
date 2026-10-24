import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AiBridgeService } from '../../../ai-bridge/ai-bridge.service';
import { insertRows, rowsOf } from '../common/sql-batch';
import { LearningPathSettingsService } from '../common/learning-path-settings.service';
import { StudentCurriculumRepository, StudentIdentity, TopicContext } from '../common/student-curriculum.repository';
import { detectWeakConcepts } from '../engine/mastery-engine';
import { evidenceDedupeKey } from '../evidence/evidence.mapper';
import { LearningPathQueueService } from '../jobs/learning-path-queue.service';
import { LearningEventsService } from '../common/learning-events.service';
import {
  buildQuizQuestions,
  gradeQuiz,
  QuizGrade,
  QuizQuestion,
  sanitizeAnswers,
  toStudentQuestions,
} from './quiz-questions';

export type QuizKind = 'quiz' | 'assessment';

interface Batch {
  difficulty: string;
  /** How many of this difficulty end up in the quiz. */
  keep: number;
}

interface QuizPlan {
  batches: Batch[];
  /** Fewer valid questions than this and the quiz is not created at all. */
  minQuestions: number;
  /** Assessments are timed; quizzes are not. */
  secondsPerQuestion: number | null;
}

/** Assessment mix is fixed (about 30% easy / 50% medium / 20% hard) so before/after scores compare fairly. */
export const QUIZ_PLANS: Record<QuizKind, QuizPlan> = {
  quiz: { batches: [{ difficulty: 'easy_medium', keep: 8 }], minQuestions: 5, secondsPerQuestion: null },
  assessment: {
    batches: [
      { difficulty: 'easy', keep: 5 },
      { difficulty: 'medium', keep: 8 },
      { difficulty: 'hard', keep: 3 },
    ],
    minQuestions: 12,
    secondsPerQuestion: 90,
  },
};

/** Ask for a few extra per batch: validation drops questions with a guessed key or broken options. */
const OVERGENERATE = 2;
/** The AI service returns at most 10 questions per call. */
const MAX_PER_CALL = 10;
/** A submit arriving this soon after the timer ran out still counts (network latency). */
const SUBMIT_GRACE_MS = 30_000;
/** Generation calls the LLM; cap how many quizzes one student can start per hour. */
const MAX_INSTANCES_PER_HOUR = 20;
const MAX_ANSWER_KEYS = 100;

export interface CreateQuizInput {
  student: StudentIdentity;
  topic: TopicContext;
  kind: QuizKind;
  round?: number;
  concepts?: string[];
  threadId?: string | null;
  stepId?: string | null;
}

@Injectable()
export class QuizEngineService {
  private readonly logger = new Logger(QuizEngineService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridge: AiBridgeService,
    private readonly curriculum: StudentCurriculumRepository,
    private readonly settings: LearningPathSettingsService,
    private readonly queue: LearningPathQueueService,
    private readonly events: LearningEventsService,
  ) {}

  /** Generate, validate and store a quiz or assessment; returns the student's view (no answer key). */
  async createInstance(input: CreateQuizInput) {
    const { student, topic, kind } = input;
    await this.enforceRateLimit(student.studentId);

    const plan = QUIZ_PLANS[kind];
    const concepts = (input.concepts ?? []).filter(Boolean).slice(0, 12);
    const questions = await this.generateQuestions(student, topic, plan, concepts, kind);
    if (questions.length < plan.minQuestions) {
      this.logger.warn(`Only ${questions.length} valid ${kind} questions for topic ${topic.topicId}`);
      throw new ServiceUnavailableException('Could not prepare enough good questions right now. Please try again.');
    }

    const expiresAt = plan.secondsPerQuestion
      ? new Date(Date.now() + questions.length * plan.secondsPerQuestion * 1000)
      : null;
    const rows = await this.ds.query(
      `INSERT INTO learning_quiz_instances
         (institute_id, student_id, subject_id, chapter_id, topic_id, thread_id, step_id, round, kind,
          concepts, questions_json, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        student.instituteId, student.studentId, topic.subjectId, topic.chapterId, topic.topicId,
        input.threadId ?? null, input.stepId ?? null, input.round ?? 1, kind,
        JSON.stringify(concepts), JSON.stringify(questions), expiresAt,
      ],
    );
    return this.inProgressView(rows[0]);
  }

  /** Resume: in-progress view with saved answers, or the result once submitted. An expired assessment is finalised here. */
  async getInstance(user: any, instanceId: string) {
    const student = await this.requireStudent(user);
    const row = await this.loadOwned(this.ds.manager, student.studentId, instanceId);
    if (row.status === 'in_progress' && this.isPastDeadline(row, 0)) {
      return this.autoFinalize(student, instanceId);
    }
    return row.status === 'in_progress' ? this.inProgressView(row) : this.resultView(row);
  }

  /** Finalise a timed-out attempt; if another request finalised it first, just show that result. */
  private async autoFinalize(student: StudentIdentity, instanceId: string) {
    try {
      return await this.finalize(student, instanceId, null);
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      return this.resultView(await this.loadOwned(this.ds.manager, student.studentId, instanceId));
    }
  }

  async saveDraft(user: any, instanceId: string, answers: unknown) {
    const student = await this.requireStudent(user);
    const row = await this.loadOwned(this.ds.manager, student.studentId, instanceId);
    if (row.status !== 'in_progress') throw new ConflictException('This attempt has already been submitted');
    if (this.isPastDeadline(row, 0)) return this.autoFinalize(student, instanceId);

    const clean = sanitizeAnswers(this.questionsOf(row), this.limitKeys(answers));
    const updated = rowsOf(
      await this.ds.query(
        `UPDATE learning_quiz_instances SET draft_answers = $1, updated_at = NOW()
          WHERE id = $2 AND status = 'in_progress' RETURNING updated_at`,
        [JSON.stringify(clean), instanceId],
      ),
    );
    if (!updated.length) throw new ConflictException('This attempt has already been submitted');
    return { saved: true, answered: Object.keys(clean).length, savedAt: updated[0].updated_at };
  }

  async submit(user: any, instanceId: string, answers: unknown) {
    const student = await this.requireStudent(user);
    return this.finalize(student, instanceId, this.limitKeys(answers));
  }

  /**
   * Grade exactly once. The row lock makes a double click or a second tab get
   * a conflict instead of a second grading. After the timer (plus grace) only
   * the autosaved answers count, so a late submit cannot add answers.
   */
  private async finalize(student: StudentIdentity, instanceId: string, submitted: unknown | null) {
    const cfg = await this.settings.getMasteryConfig(student.instituteId);
    const result = await this.ds.transaction(async (manager) => {
      const row = await this.loadOwned(manager, student.studentId, instanceId, true);
      if (row.status !== 'in_progress') throw new ConflictException('This attempt has already been submitted');

      const questions = this.questionsOf(row);
      const late = this.isPastDeadline(row, SUBMIT_GRACE_MS);
      const draft = sanitizeAnswers(questions, row.draft_answers);
      const answers = submitted === null || late ? draft : { ...draft, ...sanitizeAnswers(questions, submitted) };
      const grade = gradeQuiz(questions, answers);
      const weakConcepts = detectWeakConcepts(grade.responses, cfg);
      const status = submitted === null || late ? 'auto_submitted' : 'submitted';

      await insertRows(
        manager,
        'learning_quiz_responses',
        ['instance_id', 'student_id', 'topic_id', 'question_id', 'concept_tag', 'answer', 'is_correct'],
        grade.responses.map((r) => [instanceId, student.studentId, row.topic_id, r.questionId, r.conceptTag, r.answer, r.isCorrect]),
      );
      const [updated] = rowsOf(
        await manager.query(
          `UPDATE learning_quiz_instances
              SET status = $2, submitted_at = NOW(), draft_answers = $3, score = $4, total = $5, accuracy = $6,
                  weak_concepts = $7, updated_at = NOW()
            WHERE id = $1 RETURNING *`,
          [instanceId, status, JSON.stringify(answers), grade.correct, grade.total, grade.accuracy, JSON.stringify(weakConcepts)],
        ),
      );
      await this.recordEvidence(manager, student, row, grade);
      return updated;
    });

    await this.queue.enqueueRecompute([student.studentId], 5_000).catch((err) =>
      this.logger.warn(`Could not queue mastery recompute for ${student.studentId}: ${(err as Error)?.message}`),
    );
    // The thread moves on (unlocks the assessment, adds a round) before the student sees the result.
    await this.events.quizFinalized({
      studentId: student.studentId,
      instanceId,
      threadId: result.thread_id ?? null,
      stepId: result.step_id ?? null,
      kind: result.kind,
      round: Number(result.round),
      topicId: String(result.topic_id),
      accuracy: Number(result.accuracy),
      weakConcepts: result.weak_concepts ?? [],
    });
    return this.resultView(result);
  }

  private async recordEvidence(manager: EntityManager, student: StudentIdentity, row: any, grade: QuizGrade) {
    const draft = {
      source: row.kind === 'assessment' ? ('ai_assessment' as const) : ('ai_quiz' as const),
      sourceRefId: String(row.id),
      topicId: String(row.topic_id),
      chapterId: row.chapter_id ? String(row.chapter_id) : null,
      conceptTag: null,
    };
    await manager.query(
      `INSERT INTO student_topic_evidence
         (institute_id, student_id, subject_id, chapter_id, topic_id, concept_tag, source, source_ref_id, dedupe_key,
          correct, total, pct, occurred_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (student_id, dedupe_key) DO NOTHING`,
      [
        student.instituteId, student.studentId, row.subject_id, draft.chapterId, draft.topicId, draft.source,
        draft.sourceRefId, evidenceDedupeKey(draft), grade.correct, grade.total, grade.accuracy,
      ],
    );
  }

  private async generateQuestions(
    student: StudentIdentity,
    topic: TopicContext,
    plan: QuizPlan,
    concepts: string[],
    kind: QuizKind,
  ): Promise<QuizQuestion[]> {
    const settled = await Promise.allSettled(
      plan.batches.map((b) =>
        this.aiBridge.generateQuestionsFromTopic(
          {
            topicId: topic.topicId,
            topicName: topic.topicName,
            count: Math.min(b.keep + OVERGENERATE, MAX_PER_CALL),
            difficulty: b.difficulty,
            type: 'mcq_single',
            subject: topic.subjectName,
            chapter: topic.chapterName,
            examTarget: `Class ${student.className || '10'}`,
            concepts: concepts.length ? concepts : undefined,
            // The concepts and difficulty are already pinned, so the model needs little
            // deliberation to produce each practice-quiz MCQ — "low" cuts the student's
            // wait without weakening the set. The formal assessment keeps full reasoning:
            // it is graded once and compares mastery before/after, so accuracy matters more.
            reasoningEffort: kind === 'quiz' ? 'low' : undefined,
          },
          student.instituteId ?? undefined,
          'school',
        ),
      ),
    );

    const raw: any[] = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled' && Array.isArray(s.value)) {
        raw.push(...s.value.map((q: any) => ({ ...q, difficulty: plan.batches[i].difficulty })));
      } else if (s.status === 'rejected') {
        this.logger.warn(`Question batch "${plan.batches[i].difficulty}" failed: ${(s.reason as Error)?.message}`);
      }
    });

    const valid = buildQuizQuestions(raw, concepts, { idPrefix: 'q' });
    const target = plan.batches.reduce((sum, b) => sum + b.keep, 0);
    // Keep each difficulty's share first, then top up from whatever is left.
    const chosen = new Set<QuizQuestion>();
    for (const b of plan.batches) {
      valid.filter((q) => q.difficulty === b.difficulty).slice(0, b.keep).forEach((q) => chosen.add(q));
    }
    for (const q of valid) {
      if (chosen.size >= target) break;
      chosen.add(q);
    }
    return valid.filter((q) => chosen.has(q));
  }

  private async enforceRateLimit(studentId: string) {
    const [{ n }] = await this.ds.query(
      `SELECT COUNT(*)::int AS n FROM learning_quiz_instances
        WHERE student_id::text = $1::text AND created_at > NOW() - interval '1 hour'`,
      [studentId],
    );
    if (n >= MAX_INSTANCES_PER_HOUR) {
      throw new HttpException('Too many quizzes started in the last hour. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async requireStudent(user: any): Promise<StudentIdentity> {
    const student = await this.curriculum.findStudentByUserId(user.id);
    if (!student) throw new NotFoundException('Student profile not found');
    return student;
  }

  /** Ownership is part of the WHERE clause: another student's id is simply "not found". */
  private async loadOwned(manager: EntityManager, studentId: string, instanceId: string, lock = false) {
    const rows = await manager.query(
      `SELECT * FROM learning_quiz_instances WHERE id::text = $1::text AND student_id::text = $2::text${lock ? ' FOR UPDATE' : ''}`,
      [instanceId, studentId],
    );
    if (!rows.length) throw new NotFoundException('Quiz not found');
    return rows[0];
  }

  private isPastDeadline(row: any, graceMs: number): boolean {
    return !!row.expires_at && Date.now() > new Date(row.expires_at).getTime() + graceMs;
  }

  private questionsOf(row: any): QuizQuestion[] {
    const q = typeof row.questions_json === 'string' ? JSON.parse(row.questions_json) : row.questions_json;
    return Array.isArray(q) ? q : [];
  }

  private limitKeys(answers: unknown): unknown {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {};
    return Object.fromEntries(Object.entries(answers as object).slice(0, MAX_ANSWER_KEYS));
  }

  private inProgressView(row: any) {
    const remainingSeconds = row.expires_at
      ? Math.max(0, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000))
      : null;
    return {
      instanceId: row.id,
      kind: row.kind as QuizKind,
      status: row.status,
      round: row.round,
      topicId: row.topic_id,
      questions: toStudentQuestions(this.questionsOf(row)),
      draftAnswers: row.draft_answers ?? {},
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      remainingSeconds,
    };
  }

  private resultView(row: any) {
    const answers = row.draft_answers ?? {};
    return {
      instanceId: row.id,
      kind: row.kind as QuizKind,
      status: row.status,
      round: row.round,
      topicId: row.topic_id,
      submittedAt: row.submitted_at,
      score: Number(row.score),
      total: Number(row.total),
      accuracy: Number(row.accuracy),
      weakConcepts: row.weak_concepts ?? [],
      questions: this.questionsOf(row).map((q) => ({
        id: q.id,
        text: q.text,
        options: q.options,
        conceptTag: q.conceptTag,
        yourAnswer: answers[q.id] ?? null,
        correctOptionId: q.correctOptionId,
        isCorrect: answers[q.id] === q.correctOptionId,
        explanation: q.explanation,
      })),
    };
  }
}
