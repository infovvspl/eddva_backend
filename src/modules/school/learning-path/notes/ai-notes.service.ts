import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../../ai-bridge/ai-bridge.service';
import { rowsOf } from '../common/sql-batch';
import { StudentCurriculumRepository, StudentIdentity, TopicContext } from '../common/student-curriculum.repository';
import {
  buildSubjectPrompt,
  extractAiSessionRef,
  extractAiText,
  extractBulletSection,
  extractFormulaCandidates,
  hasStructuredPracticeOptions,
  lessonTitleStale,
  mapRawPracticeQuestion,
  normalizeSolvedExamplesFormatting,
  shouldRegenerateLesson,
} from './lesson-content';

export interface OpenNotesOptions {
  /** Round 1 is the topic's first lesson; later rounds focus on the concepts the student got wrong. */
  round?: number;
  focusConcepts?: string[];
  /** The topic's subtopics, covered in order by a first lesson (a focused round uses focusConcepts instead). */
  subtopics?: string[];
  threadId?: string | null;
}

export interface NotesUpdate {
  highlights?: unknown[];
  inlineComments?: unknown[];
  lastAnchor?: Record<string, unknown> | null;
  timeSpentSeconds?: number;
}

const MAX_FOCUS_CONCEPTS = 8;

const MAX_SUBTOPICS = 8;

/** Labels reduced to plain single lines so they cannot reshape the prompt they are listed in. */
const promptLabels = (labels: string[], max: number) =>
  labels
    .map((c) => String(c ?? '').replace(/[\r\n`"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, max);

/** A first lesson covers the topic's subtopics (the mind-map nodes) in order, one section each. */
export function buildSubtopicAddendum(subtopics: string[]): string {
  const list = promptLabels(subtopics, MAX_SUBTOPICS);
  if (!list.length) return '';
  return `

SUBTOPICS TO COVER
Organise the Core Concepts around these subtopics, in this order, giving each its own clearly titled part:
${list.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

/** Lesson text for later rounds, appended to the subject prompt. */
export function buildFocusAddendum(focusConcepts: string[]): string {
  const concepts = promptLabels(focusConcepts, MAX_FOCUS_CONCEPTS);
  if (!concepts.length) return '';
  return `

FOCUS FOR THIS LESSON
In the student's last quiz or assessment on this topic they struggled with:
${concepts.map((c) => `- ${c}`).join('\n')}
Keep every section of the structure above, but spend most of the explanation, worked examples and practice on these concepts. Start each from the basics it depends on, show the common wrong approach next to the right one, and finish each with a short self-check question.`;
}

/**
 * AI notes for the learning path. The lesson prompts, quality checks and
 * extraction are the existing ones (lesson-content.ts), so notes look and
 * behave as before; what is new is per-round focused notes and that reading
 * notes never regenerates them.
 */
@Injectable()
export class AiNotesService {
  private readonly logger = new Logger(AiNotesService.name);
  /** Two tabs opening the same notes at once share one generation instead of paying for two. */
  private readonly inFlight = new Map<string, Promise<any>>();

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridge: AiBridgeService,
    private readonly curriculum: StudentCurriculumRepository,
  ) {}

  /** The notes for a round, generating them only if this round has no usable lesson yet. */
  async openNotes(student: StudentIdentity, topic: TopicContext, opts: OpenNotesOptions = {}) {
    const round = Math.max(1, opts.round ?? 1);
    const key = `${student.studentId}:${topic.topicId}:${opts.threadId ?? '-'}:${round}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const work = this.openNotesUncached(student, topic, round, opts).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  /** Read-only: never regenerates, never calls the AI. */
  async getNotes(user: any, sessionId: string) {
    const student = await this.requireStudent(user);
    return this.view(await this.loadOwned(student.studentId, sessionId));
  }

  async saveNotes(user: any, sessionId: string, update: NotesUpdate) {
    const student = await this.requireStudent(user);
    await this.loadOwned(student.studentId, sessionId);
    const rows = rowsOf(await this.ds.query(
      `UPDATE school_ai_study_sessions
          SET highlights = COALESCE($3::jsonb, highlights),
              inline_comments = COALESCE($4::jsonb, inline_comments),
              last_anchor = CASE WHEN $5::boolean THEN $6::jsonb ELSE last_anchor END,
              time_spent_seconds = GREATEST(COALESCE(time_spent_seconds, 0), COALESCE($7::int, 0))
        WHERE id::text = $1::text AND student_id::text = $2::text
        RETURNING id`,
      [
        sessionId,
        student.studentId,
        update.highlights ? JSON.stringify(update.highlights) : null,
        update.inlineComments ? JSON.stringify(update.inlineComments) : null,
        update.lastAnchor !== undefined,
        update.lastAnchor ? JSON.stringify(update.lastAnchor) : null,
        update.timeSpentSeconds ?? null,
      ],
    ));
    return { saved: rows.length === 1 };
  }

  private async openNotesUncached(student: StudentIdentity, topic: TopicContext, round: number, opts: OpenNotesOptions) {
    const focusConcepts = (opts.focusConcepts ?? []).slice(0, MAX_FOCUS_CONCEPTS);
    const existing = await this.findSession(student.studentId, topic.topicId, round, opts.threadId ?? null);

    if (existing && !shouldRegenerateLesson(existing.lesson_markdown, topic.subjectName) && !lessonTitleStale(existing.lesson_markdown, topic.topicName)) {
      if (opts.threadId && !existing.thread_id) {
        // A round-1 lesson from the old planner is adopted by the thread, keeping the student's highlights.
        await this.ds.query(`UPDATE school_ai_study_sessions SET thread_id = $1 WHERE id = $2 AND thread_id IS NULL`, [
          opts.threadId,
          existing.id,
        ]);
        existing.thread_id = opts.threadId;
      }
      if (!hasStructuredPracticeOptions(existing.practice_questions)) {
        const practice = await this.generatePractice(student, topic).catch(() => null);
        if (practice?.length) {
          await this.ds.query(`UPDATE school_ai_study_sessions SET practice_questions = $1 WHERE id = $2`, [
            JSON.stringify(practice),
            existing.id,
          ]);
          existing.practice_questions = practice;
        }
      }
      return this.view(existing);
    }

    const studentClass = student.className || '10';
    const prompt =
      buildSubjectPrompt(
        { topic_name: topic.topicName, chapter_name: topic.chapterName, subject_name: topic.subjectName },
        studentClass,
        `School Curriculum - Class ${studentClass}`,
        `- Clear, accessible explanations suitable for the student's class (Class ${studentClass})
- NCERT-aligned content with simple worked examples
- Focus on concept understanding over calculation complexity`,
      ) + (focusConcepts.length ? buildFocusAddendum(focusConcepts) : buildSubtopicAddendum(opts.subtopics ?? []));

    // Lesson and practice questions are independent: run them concurrently.
    // reasoningEffort "low": the prompt already dictates the lesson's exact structure
    // section by section, so the model gains little from deliberating before writing —
    // skipping that cuts generation time without shortening the lesson itself.
    const lessonPromise = this.aiBridge.startTutorSession(
      { studentId: student.studentId, topicId: topic.topicId, context: prompt, reasoningEffort: 'low' },
      student.instituteId ?? 'school',
      'school',
    );
    const practicePromise = this.generatePractice(student, topic);
    practicePromise.catch(() => undefined);

    let lessonMarkdown: string;
    let aiSessionRef: string | null;
    try {
      const response = await lessonPromise;
      lessonMarkdown = normalizeSolvedExamplesFormatting(extractAiText(response));
      aiSessionRef = extractAiSessionRef(response);
    } catch (err) {
      this.logger.warn(`Lesson generation failed for topic ${topic.topicId}: ${(err as Error)?.message}`);
      if (existing?.lesson_markdown) return this.view(existing); // an imperfect lesson beats none
      throw new ServiceUnavailableException('Notes could not be prepared right now. Please try again.');
    }
    if (!lessonMarkdown.trim()) {
      if (existing?.lesson_markdown) return this.view(existing);
      throw new ServiceUnavailableException('Notes could not be prepared right now. Please try again.');
    }

    const practice = await practicePromise.catch((err) => {
      this.logger.warn(`Practice questions failed for topic ${topic.topicId}: ${(err as Error)?.message}`);
      return [];
    });
    const formulas = extractBulletSection(lessonMarkdown, 'Key Formulas');
    const fields = [
      lessonMarkdown,
      JSON.stringify(extractBulletSection(lessonMarkdown, 'Core Concepts')),
      JSON.stringify(formulas.length ? formulas : extractFormulaCandidates(lessonMarkdown)),
      JSON.stringify(practice),
      JSON.stringify(extractBulletSection(lessonMarkdown, 'Common Mistakes Students Make')),
      aiSessionRef,
      JSON.stringify(focusConcepts),
    ];

    if (existing) {
      // Same round, unusable lesson: replace the content but keep the student's own highlights and comments.
      const [row] = rowsOf(
        await this.ds.query(
          `UPDATE school_ai_study_sessions
              SET lesson_markdown = $1, key_concepts = $2, formulas = $3, practice_questions = $4,
                  common_mistakes = $5, ai_session_ref = $6, focus_concepts = $7, thread_id = COALESCE(thread_id, $8)
            WHERE id = $9 RETURNING *`,
          [...fields, opts.threadId ?? null, existing.id],
        ),
      );
      return this.view(row);
    }

    const [row] = await this.ds.query(
      `INSERT INTO school_ai_study_sessions
         (lesson_markdown, key_concepts, formulas, practice_questions, common_mistakes, ai_session_ref, focus_concepts,
          student_id, topic_id, thread_id, round, conversation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '[]'::jsonb)
       ON CONFLICT (thread_id, round) WHERE thread_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [...fields, student.studentId, topic.topicId, opts.threadId ?? null, round],
    );
    if (row) return this.view(row);
    // Another instance stored this round first; use its notes.
    return this.view(await this.findSession(student.studentId, topic.topicId, round, opts.threadId ?? null));
  }

  /**
   * Round 1 reuses the student's existing lesson for the topic (from this
   * thread, else one the old planner made). Later rounds belong to a thread.
   */
  private async findSession(studentId: string, topicId: string, round: number, threadId: string | null) {
    if (threadId) {
      const rows = await this.ds.query(
        `SELECT * FROM school_ai_study_sessions WHERE thread_id::text = $1::text AND round = $2 LIMIT 1`,
        [threadId, round],
      );
      if (rows.length || round > 1) return rows[0] ?? null;
    }
    if (round > 1) return null;
    const rows = await this.ds.query(
      `SELECT * FROM school_ai_study_sessions
        WHERE student_id::text = $1::text AND topic_id::text = $2::text AND round = 1
          AND ($3::text IS NULL OR thread_id IS NULL)
        ORDER BY created_at DESC LIMIT 1`,
      [studentId, topicId, threadId],
    );
    return rows[0] ?? null;
  }

  private async generatePractice(student: StudentIdentity, topic: TopicContext) {
    const raw = (await this.aiBridge.generateQuestionsFromTopic(
      {
        topicId: topic.topicId,
        topicName: topic.topicName,
        count: 8,
        difficulty: 'easy_medium',
        type: 'mcq_single',
        subject: topic.subjectName,
        chapter: topic.chapterName,
        examTarget: `Class ${student.className || '10'}`,
        reasoningEffort: 'low',
      },
      student.instituteId ?? 'school',
      'school',
    )) as any[];
    return (Array.isArray(raw) ? raw : []).map(mapRawPracticeQuestion).filter((q) => q.question);
  }

  private async requireStudent(user: any): Promise<StudentIdentity> {
    const student = await this.curriculum.findStudentByUserId(user.id);
    if (!student) throw new NotFoundException('Student profile not found');
    return student;
  }

  private async loadOwned(studentId: string, sessionId: string) {
    const rows = await this.ds.query(
      `SELECT * FROM school_ai_study_sessions WHERE id::text = $1::text AND student_id::text = $2::text`,
      [sessionId, studentId],
    );
    if (!rows.length) throw new NotFoundException('Notes not found');
    return rows[0];
  }

  private view(row: any) {
    const formulas = row.formulas?.length ? row.formulas : extractFormulaCandidates(row.lesson_markdown ?? '');
    return {
      sessionId: row.id,
      topicId: row.topic_id,
      threadId: row.thread_id ?? null,
      round: row.round ?? 1,
      focusConcepts: row.focus_concepts ?? [],
      lessonMarkdown: normalizeSolvedExamplesFormatting(row.lesson_markdown),
      keyConcepts: row.key_concepts ?? [],
      formulas,
      practiceQuestions: row.practice_questions ?? [],
      commonMistakes: row.common_mistakes ?? [],
      highlights: row.highlights ?? [],
      inlineComments: row.inline_comments ?? [],
      lastAnchor: row.last_anchor ?? null,
      timeSpentSeconds: row.time_spent_seconds ?? 0,
    };
  }
}
