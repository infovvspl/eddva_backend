import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiBridgeService, AiTutorChatResult } from '../../../ai-bridge/ai-bridge.service';
import { SchoolTextbookService } from '../../textbook/school-textbook.service';
import { LearningThreadService } from './learning-thread.service';
import { sanitizeChatQuiz, scoreChatQuiz } from './chat-quiz';
import { ANSWER_ONLY, buildThreadContext, isQuizTurn, StepKind } from './thread-path';
import { ThreadStore } from './thread-store';

const HISTORY_TURNS = 20;
/** Recent messages the topic-scope check sees, so a follow-up ("why?") counts as on topic. */
const SCOPE_HISTORY_TURNS = 4;
const MAX_TURN_CHARS = 1500;
const PER_MINUTE_LIMIT = 10;
const DEFAULT_DAILY_LIMIT = 100;

/** The student's own questions in a thread, answered by the school AI tutor with the thread's context. */
@Injectable()
export class ThreadChatService {
  private readonly logger = new Logger(ThreadChatService.name);

  constructor(
    private readonly store: ThreadStore,
    private readonly threads: LearningThreadService,
    private readonly aiBridge: AiBridgeService,
    private readonly textbooks: SchoolTextbookService,
    private readonly config: ConfigService,
  ) {}

  /** mode 'quiz' asks for practice questions the student answers by tapping an option. */
  async postMessage(user: any, threadId: string, rawText: string, mode: 'chat' | 'quiz' = 'chat') {
    const student = await this.threads.requireStudent(user);
    const thread = await this.store.loadOwnedThread(this.store.manager, student.studentId, threadId);
    const text = String(rawText ?? '').trim();
    if (!text) throw new BadRequestException('Message is empty');

    // The tutor would otherwise answer assessment questions.
    if ((await this.threads.assessmentInProgress(student.studentId)) || (await this.schoolTestInProgress(user.id))) {
      throw new ForbiddenException({
        // The global exception filter passes `error` (not `code`) through to the client.
        error: 'ASSESSMENT_IN_PROGRESS',
        message: 'Chat is paused while you have an assessment or test in progress. Finish it first.',
      });
    }
    await this.enforceLimits(student.studentId);

    const [names, history, results, steps, board] = await Promise.all([
      this.threads.threadNames(thread),
      this.store.manager.query(
        `SELECT role, content_json FROM learning_thread_messages
          WHERE thread_id = $1 AND kind = 'text' ORDER BY created_at DESC LIMIT ${HISTORY_TURNS}`,
        [threadId],
      ),
      this.store.manager.query(
        `SELECT kind, round, accuracy FROM learning_quiz_instances
          WHERE thread_id = $1 AND status <> 'in_progress' ORDER BY submitted_at`,
        [threadId],
      ),
      this.store.steps(this.store.manager, threadId),
      this.resolveBoard(student.instituteId),
    ]);
    const currentStep = steps.find((s: any) => s.id === thread.current_step_id);
    const context = buildThreadContext({
      topicName: names.topic_name,
      chapterName: names.chapter_name,
      subjectName: names.subject_name,
      round: thread.current_round,
      currentStep: (currentStep?.kind as StepKind) ?? null,
      weakConcepts: thread.weak_concepts ?? [],
      results: results.map((r: any) => ({ kind: r.kind, round: r.round, accuracy: Number(r.accuracy) })),
      baselineMastery: thread.baseline_mastery === null ? null : Number(thread.baseline_mastery),
    });

    // A topic's or subtopic's chat only answers questions about it; the general AI Tutor chat answers anything.
    if (thread.scope !== 'general' && !(await this.isOnTopic(thread, names, history, text, student.instituteId))) {
      const reply =
        `I can only help with **${names.subtopic_name ?? names.topic_name ?? 'this topic'}**${names.chapter_name ? ` (${names.chapter_name})` : ''} here. ` +
        'That question looks like it is about something else. Ask it in the AI Tutor instead.';
      const round = thread.current_round;
      const [studentMessage, aiMessage] = await this.store.transaction((manager) =>
        this.store.addMessages(manager, threadId, [
          { role: 'student', kind: 'text', round, stepId: currentStep?.id ?? null, content: { text } },
          { role: 'ai', kind: 'text', round, stepId: currentStep?.id ?? null, content: { text: reply, offTopic: true } },
        ]),
      );
      return { studentMessage, aiMessage };
    }

    let passages: any[] = [];
    if (thread.scope !== 'general' && student.instituteId) {
      passages = await this.textbooks
        // Chapter-level: the thread's topic is a roadmap topic, which the textbook index does not know.
        .getGroundingPassages(student.instituteId, { chapterId: thread.chapter_id, topicId: null }, 'both')
        .then((r) => r.passages)
        .catch((err) => {
          this.logger.warn(`Grounding passages failed for thread ${threadId}: ${(err as Error)?.message}`);
          return [];
        });
    }

    let result: AiTutorChatResult;
    try {
      result = await this.aiBridge.aiTutorChat(
        {
          message: `${context}${mode === 'chat' ? ` ${ANSWER_ONLY}` : ''}\n\nStudent: ${text}`,
          mode,
          history: history
            .filter((m: any) => !isQuizTurn(m))
            .reverse()
            .map((m: any) => ({
              role: m.role === 'student' ? ('student' as const) : ('tutor' as const),
              content: String(m.content_json?.text ?? '').slice(0, MAX_TURN_CHARS),
            })),
          student: {
            className: student.className ?? undefined,
            board: board || undefined,
            subjectName: names.subject_name ?? undefined,
            chapterName: names.chapter_name ?? undefined,
            topicName: names.topic_name ?? undefined,
          },
          passages: passages.map((p: any) => ({ ...p, chapter_name: p.chapter_name ?? names.chapter_name })),
          allowWeb: this.config.get('AI_TUTOR_WEB_SEARCH') !== 'false',
        },
        student.instituteId ?? undefined,
        board || undefined,
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Thread chat failed for ${threadId}: ${(err as Error)?.message}`);
      throw new ServiceUnavailableException('The AI tutor is not available right now. Please try again.');
    }
    if (!result?.answer) throw new ServiceUnavailableException('The AI tutor could not answer right now. Please try again.');

    const quiz = sanitizeChatQuiz(result.quiz);
    // Stored only once answered, so a failed attempt can simply be retried without a dangling question.
    const round = thread.scope !== 'general' ? thread.current_round : null;
    const [studentMessage, aiMessage] = await this.store.transaction((manager) =>
      this.store.addMessages(manager, threadId, [
        { role: 'student', kind: 'text', round, stepId: currentStep?.id ?? null, content: mode === 'quiz' ? { text, mode } : { text } },
        {
          role: 'ai',
          kind: 'text',
          round,
          stepId: currentStep?.id ?? null,
          content: {
            text: result.answer,
            sources: (result.sources ?? []).slice(0, 8),
            syllabusStatus: result.syllabusStatus,
            ...(quiz ? { quiz } : {}),
          },
        },
      ]),
    );
    return { studentMessage, aiMessage };
  }

  private async enforceLimits(studentId: string) {
    const [{ minute, today }] = await this.store.manager.query(
      `SELECT COUNT(*) FILTER (WHERE m.created_at > NOW() - interval '1 minute')::int AS minute,
              COUNT(*) FILTER (WHERE m.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::int AS today
         FROM learning_thread_messages m
         JOIN learning_threads t ON t.id = m.thread_id
        WHERE t.student_id::text = $1::text AND m.role = 'student' AND m.created_at > NOW() - interval '1 day'`,
      [studentId],
    );
    if (minute >= PER_MINUTE_LIMIT) {
      throw new HttpException({ error: 'RATE_LIMITED', message: 'You are sending messages too quickly. Please wait a moment.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const raw = Number(this.config.get('LEARNING_CHAT_DAILY_LIMIT'));
    const daily = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_LIMIT;
    if (today >= daily) {
      throw new HttpException(
        { error: 'DAILY_LIMIT_REACHED', message: `You've reached today's limit of ${daily} questions. Come back tomorrow!` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** A school test being taken right now (same rule the AI tutor applies). */
  private async schoolTestInProgress(userId: string): Promise<boolean> {
    try {
      const rows = await this.store.manager.query(
        `SELECT 1 FROM assessment_submissions
          WHERE student_user_id::text = $1::text AND status = 'in_progress' AND (expires_at IS NULL OR expires_at > NOW())
          LIMIT 1`,
        [userId],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  private async resolveBoard(instituteId: string | null): Promise<string> {
    if (!instituteId) return '';
    try {
      const rows = await this.store.manager.query(`SELECT board FROM institutes WHERE id::text = $1::text LIMIT 1`, [instituteId]);
      return String(rows?.[0]?.board ?? '').trim().toLowerCase();
    } catch {
      return '';
    }
  }

  /**
   * Is the question about this thread's topic (or its chapter, prerequisites,
   * a follow-up, the student's notes or scores)? Asked of the AI service with
   * the topic's subtopics and the last few messages. If the check itself fails,
   * the question is answered: a fault must not stop a student studying.
   */
  private async isOnTopic(thread: any, names: any, history: any[], text: string, instituteId: string | null): Promise<boolean> {
    try {
      // A subtopic thread is scoped to just that subtopic's name, with no sibling subtopics
      // loosening the check — the whole point of a subtopic's own chat is to stay inside it,
      // not the rest of its parent topic. A topic thread (no subtopics) keeps the old, wider check.
      const subtopics =
        thread.scope === 'subtopic'
          ? []
          : await this.store.manager.query(`SELECT subtopics FROM learning_roadmap_topics WHERE id = $1`, [thread.topic_id]).then(([t]: any[]) => (Array.isArray(t?.subtopics) ? t.subtopics : []));
      const recent = history
        .slice(0, SCOPE_HISTORY_TURNS)
        .reverse()
        .map((m: any) => ({ role: m.role === 'student' ? ('student' as const) : ('tutor' as const), content: String(m.content_json?.text ?? '').slice(0, 400) }))
        .filter((m) => m.content);
      const res = await this.aiBridge.checkTopicScope(
        {
          topic: names.subtopic_name ?? names.topic_name ?? '',
          chapter: names.chapter_name ?? undefined,
          subject: names.subject_name ?? undefined,
          subtopics,
          history: recent,
          message: text,
        },
        instituteId ?? undefined,
      );
      return res?.on_topic !== false;
    } catch (err) {
      this.logger.warn(`Topic scope check failed for thread ${thread.id}, answering anyway: ${(err as Error)?.message}`);
      return true;
    }
  }

  /** The student's answers to a practice quiz in the chat, kept on the message so the result shows when they come back. */
  async saveQuizResult(user: any, threadId: string, messageId: string, answers: number[]) {
    const student = await this.threads.requireStudent(user);
    await this.store.loadOwnedThread(this.store.manager, student.studentId, threadId);
    const [row] = await this.store.manager.query(
      `SELECT content_json FROM learning_thread_messages WHERE id::text = $1::text AND thread_id::text = $2::text AND role = 'ai'`,
      [messageId, threadId],
    );
    const questions = row?.content_json?.quiz?.questions;
    if (!Array.isArray(questions) || !questions.length) throw new NotFoundException('This message has no quiz');
    const result = scoreChatQuiz(questions, answers);
    if (!result) throw new ConflictException('These answers do not match the quiz');
    await this.store.manager.query(
      `UPDATE learning_thread_messages SET content_json = content_json || jsonb_build_object('quizResult', $3::jsonb)
        WHERE id::text = $1::text AND thread_id::text = $2::text`,
      [messageId, threadId, JSON.stringify(result)],
    );
    return { quizResult: result };
  }
}
