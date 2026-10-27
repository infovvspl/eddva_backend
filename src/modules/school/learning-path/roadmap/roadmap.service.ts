import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { aiRequestStorage, getAiRequestContext } from '../../../../common/context/ai-request-context';
import { AiBridgeService } from '../../../ai-bridge/ai-bridge.service';
import { SchoolTextbookService } from '../../textbook/school-textbook.service';
import { LearningPathQueueService } from '../jobs/learning-path-queue.service';
import { alignRoadmap, alignSubtopics, AlignedRoadmap, fallbackRoadmap } from './roadmap-align';

export interface RoadmapTopic {
  id: string;
  ord: number;
  name: string;
  subtopics: { id: string; name: string }[];
}

export interface ChapterRoadmap {
  state: 'ready' | 'pending';
  /** 'ai', or 'fallback' (one topic, after repeated AI failures). */
  source: string | null;
  topics: RoadmapTopic[];
}

/** After this many failed generations the one-topic fallback is stored, so a weak node is never a dead end. */
export const MAX_ROADMAP_ATTEMPTS = 3;
/**
 * Wait before the next attempt after the 1st and 2nd failure. The home screen
 * asks for a preparing roadmap every few seconds, so without a wait a short AI
 * outage (e.g. a restart) used up every attempt within a minute.
 */
export const FAILURE_BACKOFF_MS = [60 * 1000, 5 * 60 * 1000];
/** A fallback roadmap is retried with the AI this long after it was stored or last retried. */
export const FALLBACK_RETRY_MS = 60 * 60 * 1000;

const elapsed = (since: Date | string | null | undefined, now: number) => (since ? now - new Date(since).getTime() : Infinity);

/** Whether a roadmap that has failed `attempts` times may be tried again. */
export function failureRetryDue(attempts: number, updatedAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (attempts <= 0) return true;
  const wait = FAILURE_BACKOFF_MS[Math.min(attempts, FAILURE_BACKOFF_MS.length) - 1];
  return elapsed(updatedAt, now) >= wait;
}

export function fallbackRetryDue(updatedAt: Date | string | null | undefined, now = Date.now()): boolean {
  return elapsed(updatedAt, now) >= FALLBACK_RETRY_MS;
}
const MAX_PASSAGES = 6;

/**
 * Run an AI call attributed to `instituteId`. Roadmaps are made in a queue job,
 * outside any HTTP request, and AI admission control refuses a call with no
 * institute in its context. The institute here is a server-side value (the
 * student's, stored on the job, or the chapter's), never client input. A call
 * already inside a request keeps that request's context.
 */
export function withInstitute<T>(instituteId: string | null, fn: () => Promise<T>): Promise<T> {
  const ctx = getAiRequestContext();
  if (ctx.instituteId || !instituteId) return fn();
  return aiRequestStorage.run({ ...ctx, instituteId, requestId: ctx.requestId ?? randomUUID() }, fn);
}

/**
 * AI roadmaps, made only where a student is weak and shared by the school:
 * a chapter roadmap (topics in teaching order, each with subtopics) for a
 * weak chapter, and a topic roadmap (just its subtopics) for a weak topic of
 * a chapter that is otherwise fine. The school's recorded topics are linked,
 * never changed.
 */
@Injectable()
export class RoadmapService {
  private readonly logger = new Logger(RoadmapService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridge: AiBridgeService,
    private readonly textbooks: SchoolTextbookService,
    private readonly queue: LearningPathQueueService,
  ) {}

  /** Chapter roadmaps (ready ones; others pending). */
  async chapterRoadmaps(chapterIds: string[]): Promise<Map<string, ChapterRoadmap>> {
    const out = new Map<string, ChapterRoadmap>();
    if (!chapterIds.length) return out;
    const rows = await this.ds.query(
      `SELECT r.chapter_id::text AS chapter_id, r.source, t.id::text AS topic_id, t.ord, t.name,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object('id', rs.id, 'name', rs.name) ORDER BY rs.ord)
                   FROM learning_roadmap_subtopics rs WHERE rs.roadmap_topic_id = t.id AND rs.active),
                '[]'::jsonb
              ) AS subtopics
         FROM learning_roadmaps r
         LEFT JOIN learning_roadmap_topics t ON t.chapter_id = r.chapter_id AND t.ord IS NOT NULL
        WHERE r.kind = 'chapter' AND r.status = 'ready' AND r.chapter_id::text = ANY($1::text[])
        ORDER BY r.chapter_id, t.ord`,
      [chapterIds],
    );
    for (const r of rows) {
      const map = out.get(r.chapter_id) ?? { state: 'ready' as const, source: r.source, topics: [] };
      if (r.topic_id) {
        const subtopics = Array.isArray(r.subtopics) ? r.subtopics.map((s: any) => ({ id: s.id, name: String(s.name ?? '').trim() })) : [];
        map.topics.push({ id: r.topic_id, ord: Number(r.ord), name: r.name, subtopics });
      }
      out.set(r.chapter_id, map);
    }
    for (const id of chapterIds) if (!out.has(id)) out.set(id, { state: 'pending', source: null, topics: [] });
    return out;
  }

  /** The subtopics of a roadmap topic: its quiz concepts and the order its first notes follow. */
  async forTopic(topicId: string): Promise<string[]> {
    const [row] = await this.ds.query(`SELECT subtopics FROM learning_roadmap_topics WHERE id::text = $1::text`, [topicId]);
    return Array.isArray(row?.subtopics) ? row.subtopics : [];
  }

  /** A topic's active subtopics, with their stable ids, in order. */
  async subtopicsOf(topicId: string): Promise<{ id: string; ord: number; name: string }[]> {
    const rows = await this.ds.query(
      `SELECT id::text, ord, name FROM learning_roadmap_subtopics WHERE roadmap_topic_id::text = $1::text AND active ORDER BY ord`,
      [topicId],
    );
    return rows.map((r: any) => ({ id: r.id, ord: Number(r.ord), name: r.name }));
  }

  /** One subtopic's name by its id, or null if it does not exist or was retired. */
  async subtopicName(subtopicId: string): Promise<string | null> {
    const [row] = await this.ds.query(`SELECT name FROM learning_roadmap_subtopics WHERE id::text = $1::text AND active`, [subtopicId]);
    return row?.name ?? null;
  }

  /**
   * Keeps a topic's subtopics identified by a stable id across regenerations:
   * an existing active row is reused (by normalized-name match) and just
   * moved/renamed, a new name gets a new row, and one the AI no longer
   * returns is retired (active = false), never deleted, so anything already
   * pointing at it (a thread, a mastery row) keeps a valid id.
   */
  private async writeSubtopics(manager: EntityManager, roadmapTopicId: string, subtopicNames: string[]): Promise<void> {
    const existing = await manager.query(
      `SELECT id::text, name FROM learning_roadmap_subtopics WHERE roadmap_topic_id = $1 AND active`,
      [roadmapTopicId],
    );
    const aligned = alignSubtopics(subtopicNames, existing);
    if (!aligned.subtopics.length) return;
    // Move every existing active row out of the way before reassigning final ord values one at a
    // time, so a reorder never transiently collides with uq_learning_roadmap_subtopics_order
    // (same idiom already used for learning_roadmap_topics.ord elsewhere in this file).
    await manager.query(`UPDATE learning_roadmap_subtopics SET ord = ord + 10000 WHERE roadmap_topic_id = $1 AND active`, [roadmapTopicId]);
    for (const s of aligned.subtopics) {
      const reuseId = aligned.matches.get(s.ord);
      if (reuseId) {
        await manager.query(`UPDATE learning_roadmap_subtopics SET ord = $2, name = $3 WHERE id = $1`, [reuseId, s.ord, s.name]);
      } else {
        await manager.query(`INSERT INTO learning_roadmap_subtopics (roadmap_topic_id, ord, name) VALUES ($1, $2, $3)`, [roadmapTopicId, s.ord, s.name]);
      }
    }
    if (aligned.retired.length) {
      await manager.query(`UPDATE learning_roadmap_subtopics SET active = false WHERE id = ANY($1::uuid[])`, [aligned.retired]);
    }
  }

  async requestChapterRoadmaps(chapterIds: string[], instituteId: string | null, className: string | null): Promise<number> {
    const unique = [...new Set(chapterIds)];
    return this.queue.enqueueRoadmaps(unique.map((chapterId) => ({ kind: 'chapter' as const, chapterId, topicId: null, instituteId, className })));
  }

  async requestTopicRoadmaps(topics: { chapterId: string; topicId: string }[], instituteId: string | null, className: string | null): Promise<number> {
    const unique = [...new Map(topics.map((t) => [t.topicId, t])).values()];
    return this.queue.enqueueRoadmaps(unique.map((t) => ({ kind: 'topic' as const, chapterId: t.chapterId, topicId: t.topicId, instituteId, className })));
  }

  // ── Chapter roadmap ────────────────────────────────────────────────────────

  async generateForChapter(chapterId: string, instituteId: string | null, className: string | null): Promise<void> {
    const [existing] = await this.ds.query(
      `SELECT status, source, attempts, updated_at FROM learning_roadmaps WHERE kind = 'chapter' AND chapter_id::text = $1::text`,
      [chapterId],
    );
    if (existing?.status === 'ready') {
      if (existing.source === 'fallback' && fallbackRetryDue(existing.updated_at)) await this.upgradeChapterFallback(chapterId, instituteId, className);
      return;
    }
    if (existing && !failureRetryDue(Number(existing.attempts), existing.updated_at)) return;
    const chapter = await this.chapter(chapterId);
    if (!chapter) return;
    const recorded: { id: string; name: string }[] = await this.ds.query(
      `SELECT id::text, name FROM topics WHERE chapter_id::text = $1::text ORDER BY sort_order NULLS LAST, name`,
      [chapterId],
    );
    const tenant = instituteId ?? chapter.institute_id ?? null;

    let aligned = await this.askAiForChapter(chapter, recorded, tenant, className);
    let source = 'ai';
    if (!aligned) {
      if (Number(existing?.attempts ?? 0) + 1 < MAX_ROADMAP_ATTEMPTS) {
        await this.countFailure('chapter', chapterId, null, tenant);
        return;
      }
      aligned = fallbackRoadmap(chapter.name, recorded);
      source = 'fallback';
    }
    if (await this.storeChapter(chapterId, tenant, aligned, source)) await this.recomputeStudentsOf(chapterId);
  }

  private async askAiForChapter(
    chapter: { id: string; name: string; subject_name: string },
    recorded: { id: string; name: string }[],
    tenant: string | null,
    className: string | null,
  ): Promise<AlignedRoadmap | null> {
    try {
      const [passages, board] = await Promise.all([this.passages(tenant, chapter.id), this.board(tenant)]);
      const result = await withInstitute(tenant, () =>
        this.aiBridge.generateChapterRoadmap(
          {
            subject: chapter.subject_name,
            chapter: chapter.name,
            className: className ?? undefined,
            board: board || undefined,
            existingTopics: recorded.map((r) => r.name.trim()),
            passages,
          },
          tenant ?? undefined,
        ),
      );
      const aligned = alignRoadmap(result?.topics ?? [], recorded);
      return aligned.topics.length ? aligned : null;
    } catch (err) {
      this.logger.warn(`Chapter roadmap failed for ${chapter.id}: ${(err as Error)?.message}`);
      return null;
    }
  }

  /**
   * A fallback roadmap (stored after the AI kept failing, e.g. while the AI
   * service was down) is provisional: every FALLBACK_RETRY_MS the AI is tried
   * again, and on success the chapter gets its real roadmap. The school's
   * topics are relinked to the AI topics that cover them. A fallback topic is
   * removed unless a student has a chat on it (that one stays at the end so the
   * chat carries on); a school topic the AI did not cover is then unlinked.
   */
  private async upgradeChapterFallback(chapterId: string, instituteId: string | null, className: string | null): Promise<void> {
    const chapter = await this.chapter(chapterId);
    if (!chapter) return;
    const recorded: { id: string; name: string }[] = await this.ds.query(
      `SELECT id::text, name FROM topics WHERE chapter_id::text = $1::text ORDER BY sort_order NULLS LAST, name`,
      [chapterId],
    );
    const tenant = instituteId ?? chapter.institute_id ?? null;
    const aligned = await this.askAiForChapter(chapter, recorded, tenant, className);
    if (!aligned) {
      await this.touch('chapter', chapterId); // try again after another FALLBACK_RETRY_MS
      return;
    }

    const upgraded = await this.ds.transaction(async (manager) => {
      const [row] = await manager.query(
        `SELECT source FROM learning_roadmaps WHERE kind = 'chapter' AND chapter_id = $1 FOR UPDATE`,
        [chapterId],
      );
      if (row?.source !== 'fallback') return false; // another worker upgraded it first

      const old: { id: string }[] = await manager.query(
        `SELECT id::text FROM learning_roadmap_topics WHERE chapter_id = $1 AND ord IS NOT NULL ORDER BY ord`,
        [chapterId],
      );
      // Move the fallback out of the way of the new order before inserting the AI topics.
      await manager.query(`UPDATE learning_roadmap_topics SET ord = ord + 10000 WHERE chapter_id = $1 AND ord IS NOT NULL`, [chapterId]);
      const ids = new Map<number, string>();
      for (const t of aligned.topics) {
        const [ins] = await manager.query(
          `INSERT INTO learning_roadmap_topics (chapter_id, ord, name, subtopics) VALUES ($1, $2, $3, $4) RETURNING id::text`,
          [chapterId, t.ord, t.name, JSON.stringify(t.subtopics)],
        );
        ids.set(t.ord, ins.id);
        await this.writeSubtopics(manager, ins.id, t.subtopics);
      }
      for (const [recordedId, ord] of aligned.links) {
        await manager.query(
          `INSERT INTO learning_roadmap_topic_links (curriculum_topic_id, roadmap_topic_id, chapter_id) VALUES ($1, $2, $3)
           ON CONFLICT (curriculum_topic_id) DO UPDATE SET roadmap_topic_id = EXCLUDED.roadmap_topic_id`,
          [recordedId, ids.get(ord), chapterId],
        );
      }
      // An old topic a student has a chat on, or one made by a topic roadmap (it has real
      // subtopics), goes at the end. The rest are removed; a school topic the AI did not
      // cover is then unlinked and judged on its own, as with a first-time AI roadmap.
      const kept: { id: string }[] = old.length
        ? await manager.query(
            `SELECT t.id::text FROM learning_roadmap_topics t
              WHERE t.id = ANY($1::uuid[])
                AND (EXISTS (SELECT 1 FROM learning_threads th WHERE th.topic_id = t.id)
                     OR EXISTS (SELECT 1 FROM learning_roadmap_topic_links l
                                  JOIN learning_roadmaps r ON r.kind = 'topic' AND r.curriculum_topic_id = l.curriculum_topic_id
                                 WHERE l.roadmap_topic_id = t.id))
              ORDER BY t.ord`,
            [old.map((t) => t.id)],
          )
        : [];
      // Covered school topics were relinked above; any link still on an old fallback topic is one
      // the AI did not cover (a topic roadmap's own link stays).
      if (old.length) {
        await manager.query(
          `DELETE FROM learning_roadmap_topic_links l
            WHERE l.roadmap_topic_id = ANY($1::uuid[])
              AND NOT EXISTS (SELECT 1 FROM learning_roadmaps r WHERE r.kind = 'topic' AND r.curriculum_topic_id = l.curriculum_topic_id)`,
          [old.map((t) => t.id)],
        );
      }
      const keep = new Set(kept.map((t) => t.id));
      let next = aligned.topics.length;
      for (const t of old) {
        if (keep.has(t.id)) await manager.query(`UPDATE learning_roadmap_topics SET ord = $2 WHERE id = $1`, [t.id, ++next]);
        else await manager.query(`DELETE FROM learning_roadmap_topics WHERE id = $1`, [t.id]);
      }
      await manager.query(
        `UPDATE learning_roadmaps SET source = 'ai', attempts = 0, generated_at = NOW(), updated_at = NOW()
          WHERE kind = 'chapter' AND chapter_id = $1`,
        [chapterId],
      );
      return true;
    });
    if (upgraded) {
      this.logger.log(`Upgraded fallback roadmap of chapter ${chapterId} to an AI roadmap`);
      await this.recomputeStudentsOf(chapterId);
    }
  }

  /** Record a retry of a fallback, so the next one waits FALLBACK_RETRY_MS. */
  private async touch(kind: 'chapter' | 'topic', id: string) {
    await this.ds.query(
      kind === 'chapter'
        ? `UPDATE learning_roadmaps SET updated_at = NOW() WHERE kind = 'chapter' AND chapter_id::text = $1::text`
        : `UPDATE learning_roadmaps SET updated_at = NOW() WHERE kind = 'topic' AND curriculum_topic_id::text = $1::text`,
      [id],
    );
  }

  /**
   * Fallback roadmaps of these chapters (chapter and topic kind) whose retry is
   * due. A topic fallback a chapter roadmap has since taken into its order is
   * left to the chapter roadmap.
   */
  async fallbacksDue(chapterIds: string[]): Promise<{ kind: 'chapter' | 'topic'; chapterId: string; topicId: string | null }[]> {
    if (!chapterIds.length) return [];
    const rows = await this.ds.query(
      `SELECT r.kind, r.chapter_id::text AS chapter_id, r.curriculum_topic_id::text AS topic_id
         FROM learning_roadmaps r
         LEFT JOIN learning_roadmap_topic_links l ON r.kind = 'topic' AND l.curriculum_topic_id = r.curriculum_topic_id
         LEFT JOIN learning_roadmap_topics t ON t.id = l.roadmap_topic_id
        WHERE r.chapter_id::text = ANY($1::text[]) AND r.status = 'ready' AND r.source = 'fallback'
          AND r.updated_at < NOW() - make_interval(secs => $2::int)
          AND (r.kind = 'chapter' OR t.ord IS NULL)`,
      [chapterIds, FALLBACK_RETRY_MS / 1000],
    );
    return rows.map((r: any) => ({ kind: r.kind, chapterId: r.chapter_id, topicId: r.topic_id ?? null }));
  }

  /**
   * Store a chapter roadmap once. A topic already made by a topic roadmap is
   * reused for the roadmap topic that covers it (same id, name and subtopics,
   * now with a place in the order), so a student's chat on it carries over;
   * one the new roadmap does not cover is appended at the end.
   */
  private async storeChapter(chapterId: string, instituteId: string | null, roadmap: AlignedRoadmap, source: string): Promise<boolean> {
    return this.ds.transaction(async (manager) => {
      if (!(await this.claim(manager, 'chapter', chapterId, null, instituteId))) return false;

      const links = await manager.query(
        `SELECT l.curriculum_topic_id::text AS recorded_id, l.roadmap_topic_id::text AS roadmap_id
           FROM learning_roadmap_topic_links l JOIN learning_roadmap_topics t ON t.id = l.roadmap_topic_id
          WHERE l.chapter_id = $1 AND t.ord IS NULL`,
        [chapterId],
      );
      const existingByRecorded = new Map<string, string>(links.map((l: any) => [l.recorded_id, l.roadmap_id]));
      const reuse = new Map<number, string>();
      const reused = new Set<string>();
      for (const [recordedId, ord] of roadmap.links) {
        const existing = existingByRecorded.get(recordedId);
        if (existing && !reuse.has(ord) && !reused.has(existing)) {
          reuse.set(ord, existing);
          reused.add(existing);
        }
      }

      const ids = new Map<number, string>();
      for (const t of roadmap.topics) {
        const keep = reuse.get(t.ord);
        if (keep) {
          await manager.query(`UPDATE learning_roadmap_topics SET ord = $2 WHERE id = $1`, [keep, t.ord]);
          ids.set(t.ord, keep);
        } else {
          const [row] = await manager.query(
            `INSERT INTO learning_roadmap_topics (chapter_id, ord, name, subtopics) VALUES ($1, $2, $3, $4) RETURNING id::text`,
            [chapterId, t.ord, t.name, JSON.stringify(t.subtopics)],
          );
          ids.set(t.ord, row.id);
          await this.writeSubtopics(manager, row.id, t.subtopics);
        }
      }
      // Topic-roadmap topics the chapter roadmap did not cover go at the end.
      let next = roadmap.topics.length;
      for (const id of new Set(existingByRecorded.values())) {
        if (reused.has(id)) continue;
        await manager.query(`UPDATE learning_roadmap_topics SET ord = $2 WHERE id = $1`, [id, ++next]);
      }
      for (const [recordedId, ord] of roadmap.links) {
        if (existingByRecorded.has(recordedId)) continue;
        await manager.query(
          `INSERT INTO learning_roadmap_topic_links (curriculum_topic_id, roadmap_topic_id, chapter_id) VALUES ($1, $2, $3)
           ON CONFLICT (curriculum_topic_id) DO NOTHING`,
          [recordedId, ids.get(ord), chapterId],
        );
      }
      await this.markReady(manager, 'chapter', chapterId, null, source);
      return true;
    });
  }

  // ── Topic roadmap ──────────────────────────────────────────────────────────

  /** Subtopics for one weak recorded topic; skipped once a chapter roadmap already covers it. */
  async generateForTopic(chapterId: string, recordedTopicId: string, instituteId: string | null, className: string | null): Promise<void> {
    const [state] = await this.ds.query(
      `SELECT r.status, r.source, r.attempts, r.updated_at, l.roadmap_topic_id::text AS linked_to, t.ord AS linked_ord
         FROM (SELECT 1) one
         LEFT JOIN learning_roadmaps r ON r.kind = 'topic' AND r.curriculum_topic_id::text = $1::text
         LEFT JOIN learning_roadmap_topic_links l ON l.curriculum_topic_id::text = $1::text
         LEFT JOIN learning_roadmap_topics t ON t.id = l.roadmap_topic_id`,
      [recordedTopicId],
    );
    // A provisional fallback is retried; anything else that exists is final. Once a
    // chapter roadmap has taken the topic into its order, the chapter roadmap owns it.
    const upgrading =
      state.status === 'ready' && state.source === 'fallback' && fallbackRetryDue(state.updated_at) && !!state.linked_to && state.linked_ord === null;
    if (!upgrading && (state.status === 'ready' || state.linked_to)) return;
    if (!upgrading && state.status === 'failed' && !failureRetryDue(Number(state.attempts), state.updated_at)) return;
    const [recorded] = await this.ds.query(`SELECT id::text, name, chapter_id::text FROM topics WHERE id::text = $1::text`, [recordedTopicId]);
    const chapter = recorded ? await this.chapter(recorded.chapter_id) : null;
    if (!recorded || !chapter) return;
    const tenant = instituteId ?? chapter.institute_id ?? null;
    const topic = await this.askAiForTopic(chapter, recorded, tenant, className);

    if (upgrading) {
      if (!topic) return this.touch('topic', recordedTopicId);
      // Same topic row (same id), so a chat already open on it carries on with the real subtopics.
      await this.ds.transaction(async (manager) => {
        await manager.query(`UPDATE learning_roadmap_topics SET name = $2, subtopics = $3 WHERE id = $1`, [
          state.linked_to,
          topic.name,
          JSON.stringify(topic.subtopics),
        ]);
        await this.writeSubtopics(manager, state.linked_to, topic.subtopics);
        await manager.query(
          `UPDATE learning_roadmaps SET source = 'ai', attempts = 0, generated_at = NOW(), updated_at = NOW()
            WHERE kind = 'topic' AND curriculum_topic_id::text = $1::text`,
          [recordedTopicId],
        );
      });
      this.logger.log(`Upgraded fallback topic roadmap of ${recordedTopicId} to an AI roadmap`);
      return;
    }
    await this.storeTopic(chapter, recorded, tenant, topic, Number(state.attempts ?? 0));
  }

  private async askAiForTopic(
    chapter: { id: string; name: string; subject_name: string },
    recorded: { id: string; name: string },
    tenant: string | null,
    className: string | null,
  ): Promise<{ name: string; subtopics: string[] } | null> {
    try {
      const [passages, board] = await Promise.all([this.passages(tenant, chapter.id), this.board(tenant)]);
      const result = await withInstitute(tenant, () =>
        this.aiBridge.generateTopicRoadmap(
          {
            subject: chapter.subject_name,
            chapter: chapter.name,
            topic: recorded.name.trim(),
            className: className ?? undefined,
            board: board || undefined,
            passages,
          },
          tenant ?? undefined,
        ),
      );
      const subtopics = [...new Set((result?.subtopics ?? []).map((s) => String(s).trim()).filter(Boolean))].slice(0, 8);
      return subtopics.length ? { name: String(result.topic || recorded.name).trim().slice(0, 160), subtopics } : null;
    } catch (err) {
      this.logger.warn(`Topic roadmap failed for ${recorded.id}: ${(err as Error)?.message}`);
      return null;
    }
  }

  /** First generation of a topic roadmap: store it, or count the failure and fall back after the last one. */
  private async storeTopic(
    chapter: { id: string; name: string },
    recorded: { id: string; name: string },
    tenant: string | null,
    aiTopic: { name: string; subtopics: string[] } | null,
    attempts: number,
  ): Promise<void> {
    const recordedTopicId = recorded.id;
    let topic = aiTopic;
    let source = 'ai';
    if (!topic) {
      if (attempts + 1 < MAX_ROADMAP_ATTEMPTS) {
        await this.countFailure('topic', chapter.id, recordedTopicId, tenant);
        return;
      }
      topic = { name: recorded.name.trim().slice(0, 160), subtopics: [] };
      source = 'fallback';
    }

    const stored = await this.ds.transaction(async (manager) => {
      if (!(await this.claim(manager, 'topic', chapter.id, recordedTopicId, tenant))) return false;
      const [linked] = await manager.query(`SELECT 1 FROM learning_roadmap_topic_links WHERE curriculum_topic_id = $1`, [recordedTopicId]);
      if (!linked) {
        const [row] = await manager.query(
          `INSERT INTO learning_roadmap_topics (chapter_id, ord, name, subtopics) VALUES ($1, NULL, $2, $3) RETURNING id::text`,
          [chapter.id, topic!.name, JSON.stringify(topic!.subtopics)],
        );
        await manager.query(
          `INSERT INTO learning_roadmap_topic_links (curriculum_topic_id, roadmap_topic_id, chapter_id) VALUES ($1, $2, $3)`,
          [recordedTopicId, row.id, chapter.id],
        );
        await this.writeSubtopics(manager, row.id, topic!.subtopics);
      }
      await this.markReady(manager, 'topic', chapter.id, recordedTopicId, source);
      return !linked;
    });
    if (stored) await this.recomputeStudentsOf(chapter.id);
  }

  // ── Shared ─────────────────────────────────────────────────────────────────

  /** Lock this roadmap's row for writing; false when another worker already finished it. */
  private async claim(manager: EntityManager, kind: 'chapter' | 'topic', chapterId: string, recordedTopicId: string | null, instituteId: string | null) {
    const conflict = kind === 'chapter' ? `(chapter_id) WHERE kind = 'chapter'` : `(curriculum_topic_id) WHERE kind = 'topic'`;
    await manager.query(
      `INSERT INTO learning_roadmaps (kind, chapter_id, curriculum_topic_id, institute_id, status, attempts)
       VALUES ($1, $2, $3, $4, 'failed', 0) ON CONFLICT ${conflict} DO NOTHING`,
      [kind, chapterId, recordedTopicId, instituteId],
    );
    const [row] = await manager.query(
      kind === 'chapter'
        ? `SELECT status FROM learning_roadmaps WHERE kind = 'chapter' AND chapter_id = $1 FOR UPDATE`
        : `SELECT status FROM learning_roadmaps WHERE kind = 'topic' AND curriculum_topic_id = $1 FOR UPDATE`,
      [kind === 'chapter' ? chapterId : recordedTopicId],
    );
    return row.status !== 'ready';
  }

  private async markReady(manager: EntityManager, kind: 'chapter' | 'topic', chapterId: string, recordedTopicId: string | null, source: string) {
    await manager.query(
      kind === 'chapter'
        ? `UPDATE learning_roadmaps SET status = 'ready', source = $2, generated_at = NOW(), updated_at = NOW() WHERE kind = 'chapter' AND chapter_id = $1`
        : `UPDATE learning_roadmaps SET status = 'ready', source = $2, generated_at = NOW(), updated_at = NOW() WHERE kind = 'topic' AND curriculum_topic_id = $1`,
      [kind === 'chapter' ? chapterId : recordedTopicId, source],
    );
  }

  private async countFailure(kind: 'chapter' | 'topic', chapterId: string, recordedTopicId: string | null, instituteId: string | null) {
    const conflict = kind === 'chapter' ? `(chapter_id) WHERE kind = 'chapter'` : `(curriculum_topic_id) WHERE kind = 'topic'`;
    await this.ds.query(
      `INSERT INTO learning_roadmaps (kind, chapter_id, curriculum_topic_id, institute_id, status, attempts, updated_at)
       VALUES ($1, $2, $3, $4, 'failed', 1, NOW())
       ON CONFLICT ${conflict} DO UPDATE SET attempts = learning_roadmaps.attempts + 1, updated_at = NOW()
        WHERE learning_roadmaps.status = 'failed'`,
      [kind, chapterId, recordedTopicId, instituteId],
    );
  }

  private async chapter(chapterId: string) {
    const [row] = await this.ds.query(
      `SELECT c.id::text AS id, c.name, c.institute_id::text AS institute_id, s.name AS subject_name
         FROM chapters c JOIN subjects s ON s.id = c.subject_id WHERE c.id::text = $1::text`,
      [chapterId],
    );
    return row ?? null;
  }

  /** Students with marks in the chapter are recomputed so their marks move onto the new topics. */
  private async recomputeStudentsOf(chapterId: string) {
    const rows = await this.ds.query(
      `SELECT DISTINCT student_id::text AS id FROM student_topic_evidence WHERE chapter_id::text = $1::text
       UNION
       SELECT DISTINCT student_id::text FROM student_chapter_mastery WHERE chapter_id::text = $1::text AND status <> 'not_assessed'`,
      [chapterId],
    );
    await this.queue.enqueueRecompute(rows.map((r: any) => r.id)).catch((err) =>
      this.logger.warn(`Could not queue recompute after roadmap of ${chapterId}: ${(err as Error)?.message}`),
    );
  }

  private async passages(instituteId: string | null, chapterId: string): Promise<string[]> {
    if (!instituteId) return [];
    try {
      const { passages } = await this.textbooks.getGroundingPassages(instituteId, { chapterId }, 'ebook');
      return passages.slice(0, MAX_PASSAGES).map((p: any) => String(p.content ?? p.text ?? '').slice(0, 1500)).filter(Boolean);
    } catch (err) {
      this.logger.warn(`No textbook passages for chapter ${chapterId}: ${(err as Error)?.message}`);
      return [];
    }
  }

  private async board(instituteId: string | null): Promise<string> {
    if (!instituteId) return '';
    const rows = await this.ds.query(`SELECT board FROM institutes WHERE id::text = $1::text`, [instituteId]).catch(() => []);
    return String(rows?.[0]?.board ?? '').trim();
  }
}
