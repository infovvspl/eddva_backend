/**
 * Builds the home-screen mind map. Pure: the service runs the queries.
 *
 * Only what the student is weak in gets a roadmap:
 * - a chapter whose weakness is chapter-wide (see chapterScope) shows its
 *   chapter roadmap: every topic in teaching order, each with its subtopics;
 * - otherwise only the weak (or at-risk) topics are shown, each with its own
 *   topic roadmap (subtopics) — including a "weak chapter" whose marks all
 *   come from the one topic a test covered;
 * - a roadmap still being generated shows as preparing; chapters with
 *   nothing weak are collapsed into a count.
 * A topic the student already has a chat for stays visible. Chats suggested
 * as prerequisites hang under the topic whose chat suggested them. A
 * subtopic's status comes from the student's answers to questions tagged
 * with it.
 */

import { chapterCompleted, topicCompleted } from './completion';

export interface ChapterRow {
  subjectId: string;
  subjectName: string;
  chapterId: string;
  chapterName: string;
  chapterOrder: number;
}

/** A subtopic's stable identity (see learning_roadmap_subtopics) — just enough to key a thread or a thread lookup by. */
export interface SubtopicUnit {
  id: string;
  name: string;
}

/** A unit of learning: a roadmap topic, or a recorded topic no roadmap covers yet. */
export interface TopicUnit {
  id: string;
  chapterId: string;
  name: string;
  /** Position in the chapter roadmap; null for a topic-roadmap topic or a recorded topic. */
  ord: number | null;
  subtopics: SubtopicUnit[];
  kind: 'roadmap' | 'recorded';
}

export interface RoadmapInfo {
  state: 'ready' | 'pending';
  source: string | null;
  topics: { id: string; ord: number; name: string; subtopics: SubtopicUnit[] }[];
}

export interface MasteryRow {
  status: string;
  mastery: number | null;
  estMinutes: number;
  /** Chapters only: status from the chapter-level marks alone (no topic), e.g. games. */
  chapterLevelStatus?: string;
}

export interface ThreadRow {
  id: string;
  topicId: string;
  /** Set for a subtopic's own thread (scope = 'subtopic'); null for a no-subtopics topic's thread. */
  subtopicId: string | null;
  status: string;
  round: number;
  parentThreadId: string | null;
  /** Steps finished on the path (video watched, notes read, quiz taken…): 0 means opened but not started. */
  stepsDone?: number;
}

/** Answers per subtopic for one topic, keyed by the lower-cased, trimmed subtopic name. */
export type SubtopicScores = Map<string, { correct: number; total: number }>;

export interface SubtopicThresholds {
  minQuestions: number;
  weakBelow: number;
  atRisk: number;
  mastered: number;
}

export interface SubtopicNode {
  id: string;
  name: string;
  order: number;
  status: string;
  accuracy: number | null;
  answered: number;
  /** Its own video/notes/quiz/assessment/chat; null until the student opens it. */
  thread: { id: string; status: string; round: number; stepsDone: number } | null;
}

export interface TopicNode {
  topicId: string;
  name: string;
  /** Position in the chapter roadmap, when shown as part of one. */
  order: number | null;
  status: string;
  mastery: number | null;
  estMinutes: number;
  /** 'pending' while this weak topic's own roadmap is being generated (it cannot be opened yet). */
  roadmapState: 'ready' | 'pending';
  /** Null (and never created) once the topic has subtopics — each of those has its own thread instead. */
  thread: { id: string; status: string; round: number; stepsDone: number } | null;
  subtopics: SubtopicNode[];
  /** All its subtopics' threads completed (or, with none, its own thread), never its mastery/status. */
  completed: boolean;
  children: { threadId: string; topicId: string; name: string; status: string; stepsDone: number; subtopicId: string | null }[];
}

export interface ChapterNode {
  chapterId: string;
  name: string;
  status: string;
  mastery: number | null;
  estMinutes: number;
  /** Weak or at risk: shown as its chapter roadmap. */
  expanded: boolean;
  /** For an expanded chapter: 'pending' while its chapter roadmap is being generated. */
  roadmapState: 'ready' | 'pending' | null;
  /** Every topic in its full roadmap roster completed — independent of which topics are shown above. */
  completed: boolean;
  topics: TopicNode[];
}

export interface SubjectNode {
  subjectId: string;
  name: string;
  weakChapters: number;
  atRiskChapters: number;
  chapters: ChapterNode[];
  hiddenChapters: number;
}

export interface MindMapInput {
  chapters: ChapterRow[];
  chapterRoadmaps: Map<string, RoadmapInfo>;
  units: TopicUnit[];
  topicMastery: Map<string, MasteryRow>;
  chapterMastery: Map<string, MasteryRow>;
  threads: ThreadRow[];
  /** Subtopic answers by topic id. */
  scores: Map<string, SubtopicScores>;
  thresholds: SubtopicThresholds;
}

export interface MindMapResult {
  subjects: SubjectNode[];
  /** Weak chapters whose chapter roadmap still has to be generated. */
  chapterRoadmapsNeeded: string[];
  /** Weak recorded topics (in chapters that are fine) whose topic roadmap still has to be generated. */
  topicRoadmapsNeeded: { chapterId: string; topicId: string }[];
}

const NEEDS_ATTENTION = new Set(['weak', 'at_risk']);
const SEVERITY: Record<string, number> = { weak: 0, at_risk: 1, insufficient_data: 2, not_assessed: 3, ok: 4, mastered: 5 };
const NONE: MasteryRow = { status: 'not_assessed', mastery: null, estMinutes: 0 };

const key = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const bySeverity = <T extends { status: string; mastery: number | null }>(a: T, b: T) =>
  (SEVERITY[a.status] ?? 9) - (SEVERITY[b.status] ?? 9) || (a.mastery ?? 101) - (b.mastery ?? 101);

/**
 * Whether a flagged chapter is weak as a chapter, or only in one topic.
 * Its status pools every mark in the chapter, so a test covering one topic
 * makes the chapter as weak as that topic. It is shown as a chapter roadmap
 * when the weakness is chapter-wide:
 * - its chapter-level marks alone (games, chapter-tagged tests) are weak; or
 * - two or more of its topics are weak or at risk; or
 * - no single topic explains it (its marks cannot be traced to a weak topic).
 * With exactly one weak or at-risk topic and nothing chapter-wide, that topic
 * is shown on its own with its topic roadmap.
 */
export function chapterScope(chapter: MasteryRow, flaggedTopics: number): 'chapter' | 'topics' {
  if (!NEEDS_ATTENTION.has(chapter.status)) return 'topics';
  if (NEEDS_ATTENTION.has(chapter.chapterLevelStatus ?? '')) return 'chapter';
  return flaggedTopics === 1 ? 'topics' : 'chapter';
}

export function subtopicStatus(correct: number, total: number, t: SubtopicThresholds): string {
  if (!total) return 'not_assessed';
  if (total < t.minQuestions) return 'insufficient_data';
  const accuracy = (correct / total) * 100;
  if (accuracy < t.weakBelow) return 'weak';
  if (accuracy < t.atRisk) return 'at_risk';
  if (accuracy < t.mastered) return 'ok';
  return 'mastered';
}

function subtopicNodes(subtopics: SubtopicUnit[], scores: SubtopicScores | undefined, t: SubtopicThresholds, threadBySubtopic: Map<string, ThreadRow>): SubtopicNode[] {
  return subtopics.map((u, i) => {
    const s = scores?.get(key(u.name));
    const thread = threadBySubtopic.get(u.id);
    return {
      id: u.id,
      name: u.name.trim(),
      order: i + 1,
      status: subtopicStatus(s?.correct ?? 0, s?.total ?? 0, t),
      accuracy: s?.total ? Math.round((s.correct / s.total) * 1000) / 10 : null,
      answered: s?.total ?? 0,
      thread: thread ? { id: thread.id, status: thread.status, round: thread.round, stepsDone: thread.stepsDone ?? 0 } : null,
    };
  });
}

export function buildMindMap(input: MindMapInput): MindMapResult {
  const { chapters: chapterRows, chapterRoadmaps, units, topicMastery, chapterMastery, threads, scores, thresholds } = input;
  const threadByTopic = new Map(threads.filter((t) => !t.subtopicId).map((t) => [t.topicId, t]));
  const threadBySubtopic = new Map(threads.filter((t) => t.subtopicId).map((t) => [t.subtopicId!, t]));
  const threadById = new Map(threads.map((t) => [t.id, t]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const unitsByChapter = new Map<string, TopicUnit[]>();
  for (const u of units) {
    const list = unitsByChapter.get(u.chapterId) ?? [];
    list.push(u);
    unitsByChapter.set(u.chapterId, list);
  }
  const childrenOf = new Map<string, TopicNode['children']>();
  for (const t of threads) {
    if (!t.parentThreadId || !threadById.has(t.parentThreadId)) continue;
    const unit = unitById.get(t.topicId);
    const subtopicName = t.subtopicId ? unit?.subtopics.find((s) => s.id === t.subtopicId)?.name : undefined;
    const list = childrenOf.get(t.parentThreadId) ?? [];
    list.push({
      threadId: t.id,
      topicId: t.topicId,
      name: subtopicName ?? unit?.name ?? '',
      status: t.status,
      stepsDone: t.stepsDone ?? 0,
      subtopicId: t.subtopicId ?? null,
    });
    childrenOf.set(t.parentThreadId, list);
  }

  /** A topic with subtopics is judged entirely by them (its own `thread`, if an old one happens
   *  to still exist, never factors in — see the "accepted edge cases" in the per-subtopic-paths
   *  plan); one with none is judged by its own thread, exactly as before this feature existed. */
  const topicCompletedOf = (u: { id: string; subtopics: SubtopicUnit[] }): boolean =>
    topicCompleted(
      u.subtopics.length > 0,
      u.subtopics.map((s) => threadBySubtopic.get(s.id)?.status ?? null),
      threadByTopic.get(u.id)?.status ?? null,
    );

  const node = (u: { id: string; name: string; subtopics: SubtopicUnit[] }, order: number | null, roadmapState: 'ready' | 'pending'): TopicNode => {
    const m = topicMastery.get(u.id) ?? NONE;
    const thread = threadByTopic.get(u.id);
    return {
      topicId: u.id,
      name: u.name.trim(),
      order,
      status: m.status,
      mastery: m.mastery,
      estMinutes: m.estMinutes,
      roadmapState,
      thread: thread ? { id: thread.id, status: thread.status, round: thread.round, stepsDone: thread.stepsDone ?? 0 } : null,
      subtopics: subtopicNodes(u.subtopics, scores.get(u.id), thresholds, threadBySubtopic),
      completed: topicCompletedOf(u),
      children: thread ? childrenOf.get(thread.id) ?? [] : [],
    };
  };

  const chapterRoadmapsNeeded: string[] = [];
  const topicRoadmapsNeeded: MindMapResult['topicRoadmapsNeeded'] = [];
  const subjects = new Map<string, { name: string; chapters: ChapterRow[] }>();
  for (const c of chapterRows) {
    const s = subjects.get(c.subjectId) ?? { name: c.subjectName, chapters: [] };
    s.chapters.push(c);
    subjects.set(c.subjectId, s);
  }

  const out: SubjectNode[] = [];
  for (const [subjectId, s] of subjects) {
    const chapters: ChapterNode[] = [];
    let weakChapters = 0;
    let atRiskChapters = 0;
    for (const c of s.chapters) {
      const cm = chapterMastery.get(c.chapterId) ?? NONE;
      const flaggedTopics = (unitsByChapter.get(c.chapterId) ?? []).filter((u) => NEEDS_ATTENTION.has((topicMastery.get(u.id) ?? NONE).status)).length;
      const expanded = chapterScope(cm, flaggedTopics) === 'chapter';
      if (expanded && cm.status === 'weak') weakChapters++;
      if (expanded && cm.status === 'at_risk') atRiskChapters++;

      let topics: TopicNode[];
      let roadmapState: ChapterNode['roadmapState'] = null;
      if (expanded) {
        const roadmap = chapterRoadmaps.get(c.chapterId);
        roadmapState = roadmap?.state === 'ready' ? 'ready' : 'pending';
        if (roadmapState === 'pending') chapterRoadmapsNeeded.push(c.chapterId);
        topics = roadmap?.state === 'ready' ? [...roadmap.topics].sort((a, b) => a.ord - b.ord).map((t) => node(t, t.ord, 'ready')) : [];
      } else {
        topics = (unitsByChapter.get(c.chapterId) ?? [])
          .filter(
            (u) =>
              NEEDS_ATTENTION.has((topicMastery.get(u.id) ?? NONE).status) ||
              threadByTopic.has(u.id) ||
              u.subtopics.some((s) => threadBySubtopic.has(s.id)),
          )
          .map((u) => node(u, null, u.kind === 'roadmap' ? 'ready' : 'pending'))
          .sort(bySeverity);
        for (const t of topics) if (t.roadmapState === 'pending') topicRoadmapsNeeded.push({ chapterId: c.chapterId, topicId: t.topicId });
      }

      if (!expanded && !topics.length) continue;
      // Every topic of the chapter's full roadmap roster, not just whichever subset is shown
      // above (a "fine" chapter's non-weak topics are never surfaced for display at all) — a
      // chapter is only complete once literally all of them are.
      const fullRoster = chapterRoadmaps.get(c.chapterId)?.topics ?? [];
      chapters.push({
        chapterId: c.chapterId,
        name: c.chapterName.trim(),
        status: cm.status,
        mastery: cm.mastery,
        estMinutes: topics.reduce((sum, t) => sum + t.estMinutes, 0) || cm.estMinutes,
        expanded,
        completed: chapterCompleted(fullRoster.map(topicCompletedOf)),
        roadmapState,
        topics,
      });
    }
    chapters.sort(bySeverity);
    out.push({ subjectId, name: s.name.trim(), weakChapters, atRiskChapters, chapters, hiddenChapters: s.chapters.length - chapters.length });
  }
  out.sort((a, b) => b.weakChapters - a.weakChapters || b.atRiskChapters - a.atRiskChapters || a.name.localeCompare(b.name));
  return { subjects: out, chapterRoadmapsNeeded, topicRoadmapsNeeded };
}
