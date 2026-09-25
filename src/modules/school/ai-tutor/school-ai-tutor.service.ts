import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService, AiTutorChatResult } from '../../ai-bridge/ai-bridge.service';
import { SchoolTextbookService } from '../textbook/school-textbook.service';
import { CreateTutorConversationDto, SendTutorMessageDto } from './school-ai-tutor.dto';

/** Prior turns sent to the AI so follow-ups ("why?", "explain step 2") keep context. */
const HISTORY_TURNS = 10;
/** Keyword-matched passages sent when the chat is scoped to a subject or the whole class. */
const KEYWORD_PASSAGE_LIMIT = 20;
const DEFAULT_DAILY_MESSAGE_LIMIT = 50;

const STOPWORDS = new Set(
  ('the and for are was were with what why how when which who whom whose this that these those from into ' +
    'about does did can could would should will explain tell give please mean means define difference between ' +
    'kya hai hain kaise kyun batao')
    .split(' '),
);

/**
 * School AI Tutor — a standalone student chatbot.
 *
 * Owns its own conversations (school_ai_tutor_conversations / _messages) and is
 * independent of the AI Study lesson flow. Each question is answered by the AI
 * service from the school's own indexed course material first (textbook and
 * lecture passages), plus Google web results, images and YouTube videos.
 */
@Injectable()
export class SchoolAiTutorService implements OnModuleInit {
  private readonly logger = new Logger(SchoolAiTutorService.name);
  private tablesReady = false;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridge: AiBridgeService,
    private readonly textbooks: SchoolTextbookService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTables();
  }

  private async ensureTables(): Promise<void> {
    if (this.tablesReady) return;
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_ai_tutor_conversations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          institute_id UUID NOT NULL,
          student_id UUID NOT NULL,
          subject_id UUID,
          chapter_id UUID,
          topic_id UUID,
          title VARCHAR(200) NOT NULL DEFAULT 'New chat',
          message_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_school_ai_tutor_conv_student
          ON school_ai_tutor_conversations (student_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS school_ai_tutor_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id UUID NOT NULL REFERENCES school_ai_tutor_conversations(id) ON DELETE CASCADE,
          role VARCHAR(10) NOT NULL,
          content TEXT NOT NULL,
          sources JSONB NOT NULL DEFAULT '[]',
          syllabus_status VARCHAR(20),
          used_web BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_school_ai_tutor_msg_conv
          ON school_ai_tutor_messages (conversation_id, created_at);
        ALTER TABLE school_ai_tutor_messages ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '{}';
      `);
      this.tablesReady = true;
    } catch (err) {
      this.logger.error(`Failed to ensure AI tutor tables: ${(err as Error).message}`);
    }
  }

  private instituteId(user: any): string {
    return user.instituteId || user.schoolId;
  }

  private async getStudent(user: any) {
    const rows = await this.ds.query(
      `SELECT s.id AS student_id, s.section_id, sec.class_id, c.name AS class_name
       FROM students s
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       WHERE s.user_id = $1`,
      [user.id],
    );
    if (!rows.length) throw new NotFoundException('Student profile not found');
    return rows[0] as { student_id: string; section_id: string; class_id: string; class_name: string };
  }

  private async getClassSubjects(student: { class_id: string; section_id: string }) {
    // Same class/section subject resolution the study planner uses.
    return this.ds.query(
      `SELECT DISTINCT sub.id, sub.name
       FROM subjects sub
       WHERE sub.class_id::text = $1::text
         AND (sub.section_id IS NULL OR sub.section_id::text = $2::text)
       UNION
       SELECT DISTINCT scoped.id, scoped.name
       FROM teacher_academic_assignments taa
       JOIN subjects assigned_sub ON assigned_sub.id::text = taa.subject_id::text
       JOIN subjects scoped
         ON LOWER(TRIM(scoped.name)) = LOWER(TRIM(assigned_sub.name))
        AND scoped.class_id::text = $1::text
        AND (scoped.section_id IS NULL OR scoped.section_id::text = $2::text)
       WHERE taa.class_id::text = $1::text
         AND taa.section_id::text = $2::text
       ORDER BY name`,
      [student.class_id, student.section_id],
    ) as Promise<Array<{ id: string; name: string }>>;
  }

  /** Subjects → chapters → topics of the student's class, for the chat's topic picker. */
  async getSubjects(user: any) {
    const student = await this.getStudent(user);
    const subjects = await this.getClassSubjects(student);
    if (!subjects.length) return { className: student.class_name, subjects: [] };

    const rows: any[] = await this.ds.query(
      `SELECT chap.id AS chapter_id, chap.name AS chapter_name, chap.subject_id,
              t.id AS topic_id, t.name AS topic_name
       FROM chapters chap
       LEFT JOIN topics t ON t.chapter_id = chap.id
       WHERE chap.subject_id = ANY($1)
       ORDER BY chap.sort_order, chap.name, t.name`,
      [subjects.map((s) => s.id)],
    );

    const chaptersBySubject = new Map<string, Map<string, { id: string; name: string; topics: any[] }>>();
    for (const r of rows) {
      const chapters = chaptersBySubject.get(r.subject_id) ?? new Map();
      chaptersBySubject.set(r.subject_id, chapters);
      const chapter = chapters.get(r.chapter_id) ?? { id: r.chapter_id, name: r.chapter_name, topics: [] };
      chapters.set(r.chapter_id, chapter);
      if (r.topic_id) chapter.topics.push({ id: r.topic_id, name: r.topic_name });
    }

    return {
      className: student.class_name,
      subjects: subjects.map((s) => ({
        id: s.id,
        name: s.name,
        chapters: [...(chaptersBySubject.get(s.id)?.values() ?? [])],
      })),
    };
  }

  async listConversations(user: any) {
    await this.ensureTables();
    const student = await this.getStudent(user);
    return this.ds.query(
      `SELECT c.id, c.title, c.subject_id AS "subjectId", c.chapter_id AS "chapterId", c.topic_id AS "topicId",
              sub.name AS "subjectName", chap.name AS "chapterName", t.name AS "topicName",
              c.message_count AS "messageCount", c.created_at AS "createdAt", c.updated_at AS "updatedAt"
       FROM school_ai_tutor_conversations c
       LEFT JOIN subjects sub ON sub.id = c.subject_id
       LEFT JOIN chapters chap ON chap.id = c.chapter_id
       LEFT JOIN topics t ON t.id = c.topic_id
       WHERE c.student_id = $1
       ORDER BY c.updated_at DESC
       LIMIT 100`,
      [student.student_id],
    );
  }

  /**
   * Resolve and validate the chat's scope. A topic implies its chapter and a
   * chapter its subject; the subject must belong to the student's class, so a
   * student cannot pull another class's (or institute's) material into a chat.
   */
  private async resolveScope(student: any, dto: CreateTutorConversationDto) {
    let { subjectId, chapterId, topicId } = dto;

    if (topicId) {
      const rows = await this.ds.query(`SELECT chapter_id FROM topics WHERE id = $1`, [topicId]);
      if (!rows.length) throw new BadRequestException('Topic not found');
      chapterId = rows[0].chapter_id;
    }
    if (chapterId) {
      const rows = await this.ds.query(`SELECT subject_id FROM chapters WHERE id = $1`, [chapterId]);
      if (!rows.length) throw new BadRequestException('Chapter not found');
      subjectId = rows[0].subject_id;
    }
    if (subjectId) {
      const allowed = await this.getClassSubjects(student);
      if (!allowed.some((s) => s.id === subjectId)) {
        throw new ForbiddenException('This subject is not part of your class');
      }
    }
    return { subjectId: subjectId ?? null, chapterId: chapterId ?? null, topicId: topicId ?? null };
  }

  async createConversation(user: any, dto: CreateTutorConversationDto) {
    await this.ensureTables();
    const student = await this.getStudent(user);
    const scope = await this.resolveScope(student, dto);

    const rows = await this.ds.query(
      `INSERT INTO school_ai_tutor_conversations (institute_id, student_id, subject_id, chapter_id, topic_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [this.instituteId(user), student.student_id, scope.subjectId, scope.chapterId, scope.topicId],
    );
    return this.getConversation(user, rows[0].id);
  }

  private async getOwnedConversation(studentId: string, conversationId: string) {
    const rows = await this.ds.query(
      `SELECT c.*, sub.name AS subject_name, chap.name AS chapter_name, t.name AS topic_name
       FROM school_ai_tutor_conversations c
       LEFT JOIN subjects sub ON sub.id = c.subject_id
       LEFT JOIN chapters chap ON chap.id = c.chapter_id
       LEFT JOIN topics t ON t.id = c.topic_id
       WHERE c.id = $1 AND c.student_id = $2`,
      [conversationId, studentId],
    );
    if (!rows.length) throw new NotFoundException('Conversation not found');
    return rows[0];
  }

  private toMessage(row: any) {
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      sources: row.sources ?? [],
      images: row.media?.images ?? [],
      videos: row.media?.videos ?? [],
      quiz: row.media?.quiz ?? null,
      mediaPending: !!row.media?.mediaPending,
      quizResult: row.media?.quizResult ?? null,
      syllabusStatus: row.syllabus_status ?? null,
      usedWeb: !!row.used_web,
      createdAt: row.created_at,
    };
  }

  async getConversation(user: any, conversationId: string) {
    await this.ensureTables();
    const student = await this.getStudent(user);
    const conv = await this.getOwnedConversation(student.student_id, conversationId);
    const messages = await this.ds.query(
      `SELECT * FROM school_ai_tutor_messages WHERE conversation_id = $1 ORDER BY created_at`,
      [conversationId],
    );
    return {
      id: conv.id,
      title: conv.title,
      subjectId: conv.subject_id,
      chapterId: conv.chapter_id,
      topicId: conv.topic_id,
      subjectName: conv.subject_name,
      chapterName: conv.chapter_name,
      topicName: conv.topic_name,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages: messages.map((m: any) => this.toMessage(m)),
    };
  }

  async deleteConversation(user: any, conversationId: string) {
    await this.ensureTables();
    const student = await this.getStudent(user);
    await this.getOwnedConversation(student.student_id, conversationId);
    await this.ds.query(`DELETE FROM school_ai_tutor_conversations WHERE id = $1`, [conversationId]);
    return { success: true };
  }

  /** True while the student has a timed test open — the tutor must not help during a test. */
  private async hasTestInProgress(userId: string): Promise<boolean> {
    try {
      const rows = await this.ds.query(
        `SELECT 1 FROM assessment_submissions
         WHERE student_user_id::text = $1::text
           AND status = 'in_progress'
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [userId],
      );
      return rows.length > 0;
    } catch (err) {
      this.logger.warn(`Test-in-progress check failed: ${(err as Error).message}`);
      return false;
    }
  }

  private dailyLimit(): number {
    const raw = Number(this.config.get('AI_TUTOR_DAILY_MESSAGE_LIMIT'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_MESSAGE_LIMIT;
  }

  private async messagesSentToday(studentId: string): Promise<number> {
    const rows = await this.ds.query(
      `SELECT COUNT(*)::int AS n
       FROM school_ai_tutor_messages m
       JOIN school_ai_tutor_conversations c ON c.id = m.conversation_id
       WHERE c.student_id = $1 AND m.role = 'student'
         AND m.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
      [studentId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  private async resolveBoard(instituteId: string): Promise<string> {
    try {
      const rows = await this.ds.query(`SELECT board FROM institutes WHERE id = $1 LIMIT 1`, [instituteId]);
      return String(rows?.[0]?.board ?? '').trim().toLowerCase();
    } catch {
      return '';
    }
  }

  /** Lower-cased question words worth searching on, safe to put in a tsquery. */
  static searchTerms(question: string): string[] {
    const words: string[] = (question || '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
    return [...new Set(words.filter((w) => w.length > 2 && !STOPWORDS.has(w)))].slice(0, 8);
  }

  /**
   * Course passages for the AI to answer from. A chapter/topic chat sends that
   * chapter's textbook and lecture passages (the AI service ranks them against
   * the question). A subject-wide or open chat keyword-searches the textbook
   * chunks of those subjects instead, since a whole subject is too large to send.
   */
  private async coursePassages(
    instituteId: string,
    student: any,
    conv: { subject_id: string | null; chapter_id: string | null; topic_id: string | null },
    question: string,
  ): Promise<any[]> {
    if (conv.chapter_id) {
      const { passages } = await this.textbooks.getGroundingPassages(
        instituteId,
        { chapterId: conv.chapter_id, topicId: conv.topic_id },
        'both',
      );
      return passages;
    }

    const terms = SchoolAiTutorService.searchTerms(question);
    if (!terms.length) return [];
    const subjectIds = conv.subject_id
      ? [conv.subject_id]
      : (await this.getClassSubjects(student)).map((s) => s.id);
    if (!subjectIds.length) return [];

    try {
      const rows = await this.ds.query(
        `SELECT tc.content, tc.page_no, tc.chunk_index, tc.tokens, chap.name AS chapter_name
         FROM textbook_chunks tc
         JOIN chapters chap ON chap.id::text = tc.chapter_id::text
         WHERE tc.institute_id::text = $1::text
           AND chap.subject_id::text = ANY($2::text[])
           AND to_tsvector('simple', tc.content) @@ to_tsquery('simple', $3)
         ORDER BY ts_rank(to_tsvector('simple', tc.content), to_tsquery('simple', $3)) DESC
         LIMIT ${KEYWORD_PASSAGE_LIMIT}`,
        [instituteId, subjectIds, terms.join(' | ')],
      );
      return rows.map((r: any) => ({ ...r, source: 'ebook' }));
    } catch (err) {
      this.logger.warn(`AI tutor keyword passage search failed: ${(err as Error).message}`);
      return [];
    }
  }

  async sendMessage(user: any, conversationId: string, dto: SendTutorMessageDto) {
    await this.ensureTables();
    const student = await this.getStudent(user);
    const conv = await this.getOwnedConversation(student.student_id, conversationId);
    const question = dto.message.trim();
    if (!question) throw new BadRequestException('Message is empty');

    if (await this.hasTestInProgress(user.id)) {
      throw new ForbiddenException({
        code: 'TEST_IN_PROGRESS',
        message: 'The AI Tutor is paused while you have a test in progress. Finish your test first.',
      });
    }
    const limit = this.dailyLimit();
    if ((await this.messagesSentToday(student.student_id)) >= limit) {
      throw new HttpException(
        { code: 'DAILY_LIMIT_REACHED', message: `You've reached today's limit of ${limit} questions. Come back tomorrow!` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const instituteId = this.instituteId(user);
    const [historyRows, passages, board] = await Promise.all([
      this.ds.query(
        `SELECT role, content FROM school_ai_tutor_messages
         WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT ${HISTORY_TURNS}`,
        [conversationId],
      ),
      this.coursePassages(instituteId, student, conv, question),
      this.resolveBoard(instituteId),
    ]);

    let result: AiTutorChatResult;
    try {
      result = await this.aiBridge.aiTutorChat(
        {
          message: question,
          mode: dto.mode,
          history: historyRows.reverse().map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 1500) })),
          student: {
            className: student.class_name,
            board: board || undefined,
            subjectName: conv.subject_name ?? undefined,
            chapterName: conv.chapter_name ?? undefined,
            topicName: conv.topic_name ?? undefined,
          },
          passages: passages.map((p: any) => ({ ...p, chapter_name: p.chapter_name ?? conv.chapter_name })),
          allowWeb: this.config.get('AI_TUTOR_WEB_SEARCH') !== 'false',
        },
        instituteId,
        board || undefined,
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`AI tutor chat failed for conversation ${conversationId}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('The AI Tutor is not available right now. Please try again.');
    }
    if (!result?.answer) {
      throw new ServiceUnavailableException('The AI Tutor could not answer right now. Please try again.');
    }

    const saved = await this.ds.transaction(async (m) => {
      const [studentMsg] = await m.query(
        `INSERT INTO school_ai_tutor_messages (conversation_id, role, content)
         VALUES ($1, 'student', $2) RETURNING *`,
        [conversationId, question],
      );
      // +1ms keeps the tutor reply after the question even within one transaction timestamp.
      const [tutorMsg] = await m.query(
        `INSERT INTO school_ai_tutor_messages
           (conversation_id, role, content, sources, media, syllabus_status, used_web, created_at)
         VALUES ($1, 'tutor', $2, $3, $4, $5, $6, NOW() + INTERVAL '1 millisecond') RETURNING *`,
        [
          conversationId,
          result.answer,
          JSON.stringify(result.sources ?? []),
          JSON.stringify({
            images: [],
            videos: [],
            quiz: result.quiz ?? null,
            mediaPending: !!result.wantMedia && !!result.mediaQuery,
            mediaQuery: result.mediaQuery ?? '',
          }),
          result.syllabusStatus ?? null,
          !!result.usedWeb,
        ],
      );
      await m.query(
        `UPDATE school_ai_tutor_conversations
         SET message_count = message_count + 2,
             updated_at = NOW(),
             title = CASE WHEN message_count = 0 THEN $2 ELSE title END
         WHERE id = $1`,
        [conversationId, question.length > 80 ? `${question.slice(0, 77)}...` : question],
      );
      return { studentMsg, tutorMsg };
    });

    return {
      studentMessage: this.toMessage(saved.studentMsg),
      tutorMessage: this.toMessage(saved.tutorMsg),
    };
  }

  /**
   * Pictures and videos for an answer, fetched after the answer so the student
   * can start reading at once. Fetched once: the result (even an empty one, on
   * failure) is stored and returned on later calls.
   */
  async loadMedia(user: any, conversationId: string, messageId: string) {
    await this.ensureTables();
    const student = await this.getStudent(user);
    const conv = await this.getOwnedConversation(student.student_id, conversationId);
    const rows = await this.ds.query(
      `SELECT media FROM school_ai_tutor_messages WHERE id = $1 AND conversation_id = $2 AND role = 'tutor'`,
      [messageId, conversationId],
    );
    if (!rows.length) throw new NotFoundException('Message not found');
    const media = rows[0].media ?? {};
    if (!media.mediaPending) {
      return { images: media.images ?? [], videos: media.videos ?? [] };
    }

    let images: any[] = [];
    let videos: any[] = [];
    try {
      ({ images, videos } = await this.aiBridge.aiTutorMedia(
        {
          query: media.mediaQuery,
          student: {
            className: student.class_name,
            subjectName: conv.subject_name ?? undefined,
            chapterName: conv.chapter_name ?? undefined,
            topicName: conv.topic_name ?? undefined,
          },
        },
        this.instituteId(user),
      ));
    } catch (err) {
      this.logger.warn(`AI tutor media failed for message ${messageId}: ${(err as Error).message}`);
    }
    await this.ds.query(
      `UPDATE school_ai_tutor_messages
       SET media = COALESCE(media, '{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [messageId, JSON.stringify({ images: images ?? [], videos: videos ?? [], mediaPending: false })],
    );
    return { images: images ?? [], videos: videos ?? [] };
  }

  /**
   * Record a finished quiz. The score is worked out here from the stored
   * correct answers, never taken from the client.
   */
  async saveQuizResult(user: any, conversationId: string, messageId: string, answers: number[]) {
    await this.ensureTables();
    const student = await this.getStudent(user);
    await this.getOwnedConversation(student.student_id, conversationId);
    const rows = await this.ds.query(
      `SELECT media FROM school_ai_tutor_messages WHERE id = $1 AND conversation_id = $2 AND role = 'tutor'`,
      [messageId, conversationId],
    );
    const questions: Array<{ answerIndex: number }> = rows[0]?.media?.quiz?.questions ?? [];
    if (!questions.length) throw new NotFoundException('Quiz not found');
    if (answers.length !== questions.length) {
      throw new BadRequestException(`Expected ${questions.length} answers`);
    }

    const quizResult = {
      answers,
      score: answers.filter((a, i) => a === questions[i].answerIndex).length,
      total: questions.length,
      completedAt: new Date().toISOString(),
    };
    await this.ds.query(
      `UPDATE school_ai_tutor_messages
       SET media = jsonb_set(COALESCE(media, '{}'::jsonb), '{quizResult}', $2::jsonb)
       WHERE id = $1`,
      [messageId, JSON.stringify(quizResult)],
    );
    return { quizResult };
  }
}
