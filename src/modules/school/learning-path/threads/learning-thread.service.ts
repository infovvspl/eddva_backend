import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LearningEventsService, QuizFinalizedEvent } from '../common/learning-events.service';
import { LearningPathSettingsService } from '../common/learning-path-settings.service';
import { StudentCurriculumRepository, StudentIdentity, TopicContext } from '../common/student-curriculum.repository';
import { AiNotesService } from '../notes/ai-notes.service';
import { QuizEngineService } from '../quiz/quiz-engine.service';
import {
  decideAfterAssessment,
  decideAfterQuiz,
  pickPrerequisite,
  shouldSuggestPrerequisite,
  StepKind,
} from './thread-path';
import { NewMessage, ThreadStore } from './thread-store';
import { TopicVideosService } from './topic-videos.service';
import { RoadmapService } from '../roadmap/roadmap.service';

export interface OpenThreadInput {
  /** A roadmap topic (every chapter is studied through its AI roadmap topics). */
  topicId?: string;
  general?: boolean;
  /** Opened from a subtopic node on the mind map: echoed back so the page can focus on it. */
  focusSubtopic?: string;
}

export interface StepProgressInput {
  watchedVideoIds?: string[];
  videosDone?: boolean;
  notesDone?: boolean;
}

const MAX_QUIZ_CONCEPTS = 12;

/**
 * One chat per mind-map node. Holds the curved path (rounds of videos ->
 * notes -> quiz -> assessment), moves it on when a quiz or assessment is
 * graded, and returns everything needed to resume exactly where the student
 * left off.
 */
@Injectable()
export class LearningThreadService implements OnModuleInit {
  private readonly logger = new Logger(LearningThreadService.name);

  constructor(
    private readonly store: ThreadStore,
    private readonly curriculum: StudentCurriculumRepository,
    private readonly settings: LearningPathSettingsService,
    private readonly notes: AiNotesService,
    private readonly quiz: QuizEngineService,
    private readonly videos: TopicVideosService,
    private readonly events: LearningEventsService,
    private readonly roadmaps: RoadmapService,
  ) {}

  onModuleInit() {
    this.events.onQuizFinalized((event) => this.onQuizFinalized(event));
  }

  // ── Sidebar and opening a chat ─────────────────────────────────────────────

  async listThreads(user: any) {
    const student = await this.requireStudent(user);
    const rows = await this.store.manager.query(
      `SELECT th.*, t.name AS topic_name, c.name AS chapter_name, s.name AS subject_name,
              cs.kind AS current_step_kind
         FROM learning_threads th
         LEFT JOIN learning_roadmap_topics t ON t.id = th.topic_id
         LEFT JOIN chapters c ON c.id = th.chapter_id
         LEFT JOIN subjects s ON s.id = th.subject_id
         LEFT JOIN learning_thread_steps cs ON cs.id = th.current_step_id
        WHERE th.student_id::text = $1::text
        ORDER BY (th.status = 'suggested'), th.last_activity_at DESC`,
      [student.studentId],
    );
    return rows.map((r: any) => ({
      ...this.threadSummary(r),
      currentStepKind: r.current_step_kind ?? null,
    }));
  }

  /** Get or create the chat for a roadmap topic, or the student's general chat. */
  async openThread(user: any, input: OpenThreadInput) {
    const student = await this.requireStudent(user);
    if (!!input.topicId === !!input.general) throw new BadRequestException('Open exactly one of: a topic, or the general chat');

    if (input.general) {
      const id = await this.getOrCreateGeneral(student);
      return this.getThread(user, id);
    }

    const topic: TopicContext | null = await this.curriculum.findRoadmapTopic(student, input.topicId!);
    if (!topic) throw new NotFoundException('Topic not found in your curriculum');
    const threadId = await this.getOrCreateTopicThread(student, topic, { origin: 'mind_map', status: 'active' });
    await this.store.manager.query(
      `UPDATE learning_threads SET status = 'active', last_activity_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'suggested'`,
      [threadId],
    );
    // Only a real subtopic of this topic is echoed back (and remembered as opened); anything else is ignored.
    const wanted = String(input.focusSubtopic ?? '').trim().toLowerCase();
    const focusSubtopic = wanted
      ? (await this.roadmaps.forTopic(topic.topicId)).find((s) => s.trim().toLowerCase() === wanted) ?? null
      : null;
    if (focusSubtopic) {
      await this.store.manager.query(
        `UPDATE learning_threads
            SET opened_subtopics = CASE WHEN opened_subtopics ? $2 THEN opened_subtopics ELSE opened_subtopics || to_jsonb($2::text) END
          WHERE id = $1`,
        [threadId, focusSubtopic.trim()],
      );
    }
    const view = await this.getThread(user, threadId);
    return { ...view, focusSubtopic };
  }

  /** Everything the chat page needs: the path, one page of messages, and where to resume. */
  async getThread(user: any, threadId: string, before?: string) {
    const student = await this.requireStudent(user);
    const thread = await this.store.loadOwnedThread(this.store.manager, student.studentId, threadId);
    const [names, steps, page, inProgress, est] = await Promise.all([
      this.threadNames(thread),
      this.store.steps(this.store.manager, threadId),
      this.store.messagesPage(threadId, before),
      this.assessmentInProgress(student.studentId),
      thread.topic_id
        ? this.store.manager.query(`SELECT est_minutes FROM student_topic_mastery WHERE student_id = $1 AND topic_id = $2`, [student.studentId, thread.topic_id])
        : Promise.resolve([]),
    ]);

    const rounds = new Map<number, any>();
    for (const s of steps) {
      const r = rounds.get(s.round) ?? { round: s.round, focusConcepts: s.focus_concepts ?? [], steps: [] };
      r.steps.push({
        id: s.id,
        kind: s.kind,
        status: s.status,
        refId: s.ref_id ?? null,
        completedAt: s.completed_at ?? null,
        watchedCount: (s.content_json?.watched ?? []).length,
        /** The student has opened this step (its video, notes or questions). */
        opened: !!s.ref_id || !!s.content_json?.opened,
      });
      rounds.set(s.round, r);
    }
    const current = steps.find((s: any) => s.id === thread.current_step_id) ?? null;

    return {
      thread: {
        ...this.threadSummary({ ...thread, ...names }),
        weakConcepts: thread.weak_concepts ?? [],
        /** Study time the topic needs, from the student's marks (null when it has not been assessed). */
        estMinutes: est[0]?.est_minutes != null ? Number(est[0].est_minutes) : null,
      },
      rounds: [...rounds.values()],
      messages: page.messages,
      nextCursor: page.nextCursor,
      resume: current ? { stepId: current.id, kind: current.kind, refId: current.ref_id ?? null } : null,
      assessmentInProgress: inProgress,
    };
  }

  // ── Steps ──────────────────────────────────────────────────────────────────

  /**
   * Open a step and return its content: videos, notes, or the quiz/assessment
   * (resumed if one is in progress). A submitted quiz is shown as its result
   * unless `retake` is asked for; an assessment is one attempt only.
   */
  async openStep(user: any, threadId: string, stepId: string, opts: { retake?: boolean } = {}) {
    const student = await this.requireStudent(user);
    const thread = await this.store.loadOwnedThread(this.store.manager, student.studentId, threadId);
    if (thread.scope !== 'topic') throw new BadRequestException('The general chat has no steps');
    const step = await this.store.loadStep(this.store.manager, threadId, stepId);
    if (step.status === 'locked') throw new ConflictException('Finish the earlier steps first');
    if (step.status === 'skipped') throw new ConflictException('This step was replaced by a focused round below');
    const topic = await this.requireTopic(student, thread.topic_id);
    const focus: string[] = step.focus_concepts ?? [];

    let payload: any;
    switch (step.kind as StepKind) {
      case 'videos': {
        // One video: the best for this topic, class and board. A step stored under the older
        // several-video picks keeps the one already watched, or picks its best video again.
        const stored: any[] = Array.isArray(step.content_json?.videos) ? step.content_json.videos : [];
        const watchedIds: string[] = step.content_json?.watched ?? [];
        const keep = stored.find((v) => watchedIds.includes(v?.videoId)) ?? (stored.length === 1 ? stored[0] : null);
        const videos = keep ? [keep] : await this.videos.forStep(student, topic, focus);
        await this.store.manager.query(
          `UPDATE learning_thread_steps SET content_json = content_json || $2::jsonb, updated_at = NOW() WHERE id = $1`,
          [stepId, JSON.stringify({ videos, opened: true })],
        );
        payload = { kind: 'videos', videos, watched: step.content_json?.watched ?? [] };
        break;
      }
      case 'notes': {
        const subtopics = focus.length ? [] : await this.roadmaps.forTopic(topic.topicId);
        const notes = await this.notes.openNotes(student, topic, { round: step.round, focusConcepts: focus, subtopics, threadId });
        await this.store.manager.query(`UPDATE learning_thread_steps SET ref_id = $2, updated_at = NOW() WHERE id = $1`, [stepId, notes.sessionId]);
        payload = { kind: 'notes', notes };
        break;
      }
      case 'quiz':
      case 'assessment':
        payload = { kind: step.kind, quiz: await this.openQuizStep(user, student, thread, step, topic, opts.retake === true) };
        break;
    }

    await this.store.manager.query(
      `UPDATE learning_threads SET current_step_id = $2, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [threadId, stepId],
    );
    return { stepId, ...payload };
  }

  private async openQuizStep(user: any, student: StudentIdentity, thread: any, step: any, topic: TopicContext, retake: boolean) {
    if (step.ref_id) {
      const [existing] = await this.store.manager.query(`SELECT status FROM learning_quiz_instances WHERE id = $1`, [step.ref_id]);
      if (existing?.status === 'in_progress') return this.quiz.getInstance(user, step.ref_id);
      if (existing && (step.kind === 'assessment' || !retake)) return this.quiz.getInstance(user, step.ref_id);
    }
    if (step.kind === 'assessment' && (await this.assessmentInProgress(student.studentId))) {
      throw new ConflictException('Finish the assessment you already have open first');
    }

    const concepts = await this.conceptsForQuiz(thread.id, step, topic.topicId);
    const instance = await this.quiz.createInstance({
      student,
      topic,
      kind: step.kind,
      round: step.round,
      concepts,
      threadId: thread.id,
      stepId: step.id,
    });
    await this.store.manager.query(`UPDATE learning_thread_steps SET ref_id = $2, updated_at = NOW() WHERE id = $1`, [step.id, instance.instanceId]);
    await this.post(thread.id, [
      {
        role: 'ai',
        kind: step.kind === 'assessment' ? 'assessment_card' : 'quiz_card',
        stepId: step.id,
        round: step.round,
        content: {
          instanceId: instance.instanceId,
          questionCount: instance.questions.length,
          minutes: instance.remainingSeconds ? Math.round(instance.remainingSeconds / 60) : null,
          retake: !!step.ref_id,
        },
      },
    ]);
    return instance;
  }

  /**
   * What the quiz is tagged with: the round's focus concepts, else the topic's
   * subtopics (so every subtopic node on the mind map gets a measured status),
   * else the key concepts of the round's notes.
   */
  private async conceptsForQuiz(threadId: string, step: any, topicId: string): Promise<string[]> {
    const focus: string[] = step.focus_concepts ?? [];
    if (focus.length) return focus.slice(0, MAX_QUIZ_CONCEPTS);
    const subtopics = await this.roadmaps.forTopic(topicId);
    if (subtopics.length) return subtopics.slice(0, MAX_QUIZ_CONCEPTS);
    const notesStep = await this.store.roundStep(this.store.manager, threadId, step.round, 'notes');
    if (!notesStep?.ref_id) return [];
    const [session] = await this.store.manager.query(`SELECT key_concepts FROM school_ai_study_sessions WHERE id = $1`, [notesStep.ref_id]);
    const keys = Array.isArray(session?.key_concepts) ? session.key_concepts : [];
    return keys.map((k: unknown) => String(k).split(/[:–—-]/)[0].trim()).filter((k: string) => k.length > 1 && k.length <= 80).slice(0, MAX_QUIZ_CONCEPTS);
  }

  /** Videos watched / skipped, notes finished. Finishing the notes unlocks the quiz. */
  async updateStepProgress(user: any, threadId: string, stepId: string, input: StepProgressInput) {
    const student = await this.requireStudent(user);
    return this.store.transaction(async (manager) => {
      await this.store.loadOwnedThread(manager, student.studentId, threadId, true);
      const step = await this.store.loadStep(manager, threadId, stepId, true);
      if (step.status === 'locked' || step.status === 'skipped') throw new ConflictException('This step is not open');

      if (step.kind === 'videos') {
        const known = new Set((step.content_json?.videos ?? []).map((v: any) => v.videoId));
        const watched = [...new Set([...(step.content_json?.watched ?? []), ...(input.watchedVideoIds ?? []).filter((id) => known.has(id))])];
        await manager.query(
          `UPDATE learning_thread_steps SET content_json = content_json || $2::jsonb, updated_at = NOW() WHERE id = $1`,
          [stepId, JSON.stringify({ watched })],
        );
        if ((input.videosDone || watched.length) && step.status !== 'done') await this.store.setStepStatus(manager, stepId, 'done');
        return { stepId, status: input.videosDone || watched.length ? 'done' : step.status, watched };
      }

      if (step.kind === 'notes' && input.notesDone) {
        if (!step.ref_id) throw new ConflictException('Open the notes first');
        if (step.status === 'done') return { stepId, status: 'done' };
        await this.store.setStepStatus(manager, stepId, 'done');
        const quizStep = await this.store.roundStep(manager, threadId, step.round, 'quiz');
        if (quizStep?.status === 'locked') {
          await this.store.setStepStatus(manager, quizStep.id, 'active');
          await this.store.addMessages(manager, threadId, [
            { role: 'system', kind: 'step_unlocked', stepId: quizStep.id, round: step.round, content: { kind: 'quiz', text: 'Notes done. Your quiz is ready.' } },
          ]);
          await manager.query(`UPDATE learning_threads SET current_step_id = $2 WHERE id = $1`, [threadId, quizStep.id]);
        }
        return { stepId, status: 'done', unlocked: quizStep?.id ?? null };
      }
      throw new BadRequestException('Nothing to update for this step');
    });
  }

  // ── Moving the path on after grading ──────────────────────────────────────

  async onQuizFinalized(event: QuizFinalizedEvent): Promise<void> {
    if (!event.threadId) return;
    const cfg = await this.settings.getMasteryConfig(await this.instituteOf(event.studentId));
    const suggestPrereq = await this.store.transaction(async (manager) => {
      const thread = await this.store.loadOwnedThread(manager, event.studentId, event.threadId!, true);
      const step = event.stepId ? await this.store.loadStep(manager, thread.id, event.stepId, true).catch(() => null) : null;
      const messages: NewMessage[] = [
        {
          role: 'ai',
          kind: event.kind === 'assessment' ? 'assessment_result' : 'quiz_result',
          stepId: event.stepId,
          round: event.round,
          content: { instanceId: event.instanceId, accuracy: event.accuracy, weakConcepts: event.weakConcepts },
        },
      ];

      // Only the latest attempt in the current round moves the path; older retakes just report.
      const isCurrent = step && step.ref_id === event.instanceId && event.round === thread.current_round && thread.status === 'active';
      if (!isCurrent) {
        await this.store.addMessages(manager, thread.id, messages);
        return false;
      }

      if (event.kind === 'quiz') {
        await this.store.setStepStatus(manager, step.id, 'done');
        const assessment = await this.store.roundStep(manager, thread.id, event.round, 'assessment');
        if (assessment?.status !== 'locked') {
          await this.store.addMessages(manager, thread.id, messages);
          return false;
        }
        const decision = decideAfterQuiz(event.round, event.weakConcepts);
        if (decision.action === 'extend') {
          await this.store.setStepStatus(manager, assessment.id, 'skipped');
          await this.extend(manager, thread, event.round + 1, decision.focus, 'quiz', messages);
        } else {
          await this.store.setStepStatus(manager, assessment.id, 'active');
          await manager.query(`UPDATE learning_threads SET current_step_id = $2 WHERE id = $1`, [thread.id, assessment.id]);
          messages.push({ role: 'system', kind: 'step_unlocked', stepId: assessment.id, round: event.round, content: { kind: 'assessment', text: 'Quiz done. The formal assessment is now open.' } });
          await this.store.addMessages(manager, thread.id, messages);
        }
        return false;
      }

      // Formal assessment: the measured score for this topic.
      await this.store.setStepStatus(manager, step.id, 'done');
      await manager.query(`UPDATE learning_threads SET latest_mastery = $2, updated_at = NOW() WHERE id = $1`, [thread.id, event.accuracy]);
      const decision = decideAfterAssessment(event.round, event.accuracy, event.weakConcepts, cfg);
      if (decision.action === 'complete') {
        await manager.query(`UPDATE learning_threads SET status = 'completed', weak_concepts = '[]'::jsonb WHERE id = $1`, [thread.id]);
        messages.push({
          role: 'ai', kind: 'path_complete', round: event.round,
          content: { baselineMastery: thread.baseline_mastery === null ? null : Number(thread.baseline_mastery), latestMastery: event.accuracy },
        });
        await this.store.addMessages(manager, thread.id, messages);
      } else if (decision.action === 'extend') {
        await this.extend(manager, thread, event.round + 1, decision.focus, 'assessment', messages);
      } else {
        await manager.query(`UPDATE learning_threads SET status = 'needs_teacher', weak_concepts = $2 WHERE id = $1`, [thread.id, JSON.stringify(decision.focus)]);
        messages.push({ role: 'ai', kind: 'needs_teacher', round: event.round, content: { focusConcepts: decision.focus } });
        await this.store.addMessages(manager, thread.id, messages);
      }
      return shouldSuggestPrerequisite(event.accuracy, cfg);
    });

    if (suggestPrereq) await this.suggestPrerequisite(event.studentId, event.threadId);
  }

  private async extend(manager: EntityManager, thread: any, round: number, focus: string[], reason: 'quiz' | 'assessment', messages: NewMessage[]) {
    const first = await this.store.createRound(manager, thread.id, round, focus);
    await manager.query(
      `UPDATE learning_threads SET current_round = $2, current_step_id = $3, weak_concepts = $4, updated_at = NOW() WHERE id = $1`,
      [thread.id, round, first.id, JSON.stringify(focus)],
    );
    messages.push({ role: 'ai', kind: 'path_extension', round, content: { round, focusConcepts: focus, reason } });
    await this.store.addMessages(manager, thread.id, messages);
  }

  /** After a failing assessment, offer an earlier, weaker topic of the chapter as a child node with its own chat. */
  private async suggestPrerequisite(studentId: string, threadId: string) {
    try {
      const student = await this.curriculum.findStudent(studentId);
      const [thread] = await this.store.manager.query(`SELECT * FROM learning_threads WHERE id = $1`, [threadId]);
      if (!student || !thread?.topic_id) return;
      const rows = await this.store.manager.query(
        `SELECT t.id::text AS topic_id, t.ord AS sort_order, m.status, m.mastery,
                (t.id = $2) AS is_current
           FROM learning_roadmap_topics t
           LEFT JOIN student_topic_mastery m ON m.topic_id = t.id AND m.student_id::text = $1::text
          WHERE t.chapter_id = $3 AND t.ord IS NOT NULL`,
        [studentId, thread.topic_id, thread.chapter_id],
      );
      const current = rows.find((r: any) => r.is_current);
      const pick = pickPrerequisite(
        Number(current?.sort_order ?? 0),
        rows
          .filter((r: any) => !r.is_current)
          .map((r: any) => ({ topicId: r.topic_id, sortOrder: Number(r.sort_order), status: r.status, mastery: r.mastery === null ? null : Number(r.mastery) })),
      );
      if (!pick) return;
      const topic = await this.curriculum.findRoadmapTopic(student, pick);
      if (!topic) return;
      const childId = await this.getOrCreateTopicThread(student, topic, { origin: 'prerequisite', status: 'suggested', parentThreadId: threadId });
      await this.post(threadId, [
        { role: 'ai', kind: 'prerequisite_suggestion', content: { threadId: childId, topicId: topic.topicId, topicName: topic.topicName } },
      ]);
    } catch (err) {
      this.logger.warn(`Prerequisite suggestion failed for thread ${threadId}: ${(err as Error)?.message}`);
    }
  }

  // ── Creation helpers ───────────────────────────────────────────────────────

  private async getOrCreateTopicThread(
    student: StudentIdentity,
    topic: TopicContext,
    opts: { origin: 'mind_map' | 'prerequisite'; status: 'active' | 'suggested'; parentThreadId?: string },
  ): Promise<string> {
    const existing = await this.store.manager.query(
      `SELECT id FROM learning_threads WHERE student_id::text = $1::text AND topic_id::text = $2::text AND scope = 'topic'`,
      [student.studentId, topic.topicId],
    );
    if (existing.length) return existing[0].id;

    return this.store.transaction(async (manager) => {
      const [baseline] = await manager.query(
        `SELECT COALESCE(
                  (SELECT mastery FROM student_topic_mastery WHERE student_id::text = $1::text AND topic_id::text = $2::text AND status NOT IN ('not_assessed', 'insufficient_data')),
                  (SELECT mastery FROM student_chapter_mastery WHERE student_id::text = $1::text AND chapter_id::text = $3::text AND status NOT IN ('not_assessed', 'insufficient_data'))
                ) AS mastery`,
        [student.studentId, topic.topicId, topic.chapterId],
      );
      const inserted = await manager.query(
        `INSERT INTO learning_threads
           (institute_id, student_id, scope, subject_id, chapter_id, topic_id, parent_thread_id, origin, status, baseline_mastery, baseline_at)
         VALUES ($1, $2, 'topic', $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9::numeric IS NULL THEN NULL ELSE NOW() END)
         ON CONFLICT (student_id, topic_id) WHERE scope = 'topic' DO NOTHING
         RETURNING *`,
        [
          student.instituteId, student.studentId, topic.subjectId, topic.chapterId, topic.topicId,
          opts.parentThreadId ?? null, opts.origin, opts.status, baseline?.mastery ?? null,
        ],
      );
      if (!inserted.length) {
        // Created by a parallel request a moment ago.
        const [row] = await manager.query(
          `SELECT id FROM learning_threads WHERE student_id::text = $1::text AND topic_id::text = $2::text AND scope = 'topic'`,
          [student.studentId, topic.topicId],
        );
        return row.id;
      }
      const thread = inserted[0];
      const first = await this.store.createRound(manager, thread.id, 1, []);
      await manager.query(`UPDATE learning_threads SET current_step_id = $2 WHERE id = $1`, [thread.id, first.id]);
      await this.store.addMessages(manager, thread.id, [
        {
          role: 'ai',
          kind: 'welcome',
          round: 1,
          content: {
            topicName: topic.topicName,
            baselineMastery: thread.baseline_mastery === null ? null : Number(thread.baseline_mastery),
            origin: opts.origin,
          },
        },
      ]);
      return thread.id;
    });
  }

  private async getOrCreateGeneral(student: StudentIdentity): Promise<string> {
    const rows = await this.store.manager.query(
      `INSERT INTO learning_threads (institute_id, student_id, scope, origin, status)
       VALUES ($1, $2, 'general', 'general', 'active')
       ON CONFLICT (student_id) WHERE scope = 'general' DO NOTHING
       RETURNING id`,
      [student.instituteId, student.studentId],
    );
    if (rows.length) return rows[0].id;
    const [row] = await this.store.manager.query(
      `SELECT id FROM learning_threads WHERE student_id::text = $1::text AND scope = 'general'`,
      [student.studentId],
    );
    return row.id;
  }

  // ── Small helpers ─────────────────────────────────────────────────────────

  private async post(threadId: string, messages: NewMessage[]) {
    return this.store.transaction((manager) => this.store.addMessages(manager, threadId, messages));
  }

  async assessmentInProgress(studentId: string): Promise<boolean> {
    const rows = await this.store.manager.query(
      `SELECT 1 FROM learning_quiz_instances
        WHERE student_id::text = $1::text AND kind = 'assessment' AND status = 'in_progress'
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1`,
      [studentId],
    );
    return rows.length > 0;
  }

  async requireStudent(user: any): Promise<StudentIdentity> {
    const student = await this.curriculum.findStudentByUserId(user.id);
    if (!student) throw new NotFoundException('Student profile not found');
    return student;
  }

  async requireTopic(student: StudentIdentity, topicId: string): Promise<TopicContext> {
    const topic = await this.curriculum.findRoadmapTopic(student, topicId);
    if (!topic) throw new NotFoundException('This topic is no longer in your curriculum');
    return topic;
  }

  private async instituteOf(studentId: string): Promise<string | null> {
    return (await this.curriculum.findStudent(studentId))?.instituteId ?? null;
  }

  async threadNames(thread: any) {
    if (thread.scope !== 'topic') return { topic_name: null, chapter_name: null, subject_name: null };
    const [row] = await this.store.manager.query(
      `SELECT t.name AS topic_name, c.name AS chapter_name, s.name AS subject_name
         FROM learning_roadmap_topics t
         LEFT JOIN chapters c ON c.id = $2
         LEFT JOIN subjects s ON s.id = $3
        WHERE t.id = $1`,
      [thread.topic_id, thread.chapter_id, thread.subject_id],
    );
    return row ?? { topic_name: null, chapter_name: null, subject_name: null };
  }

  private threadSummary(r: any) {
    return {
      id: r.id,
      scope: r.scope,
      status: r.status,
      origin: r.origin,
      parentThreadId: r.parent_thread_id ?? null,
      topicId: r.topic_id ?? null,
      topicName: r.topic_name ?? null,
      chapterId: r.chapter_id ?? null,
      chapterName: r.chapter_name ?? null,
      subjectId: r.subject_id ?? null,
      subjectName: r.subject_name ?? null,
      round: r.current_round,
      currentStepId: r.current_step_id ?? null,
      baselineMastery: r.baseline_mastery === null || r.baseline_mastery === undefined ? null : Number(r.baseline_mastery),
      latestMastery: r.latest_mastery === null || r.latest_mastery === undefined ? null : Number(r.latest_mastery),
      lastActivityAt: r.last_activity_at,
    };
  }
}
