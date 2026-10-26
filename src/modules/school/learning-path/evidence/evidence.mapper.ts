import { EvidenceSource } from '../engine/mastery-config';

/**
 * Pure mapping from other modules' rows to evidence drafts. The ingestor runs
 * the SQL and adds student/institute identity; everything that decides what a
 * row means for mastery lives here so it can be unit-tested.
 */

export interface EvidenceDraft {
  source: EvidenceSource;
  sourceRefId: string;
  subjectId: string | null;
  chapterId: string | null;
  topicId: string | null;
  conceptTag: string | null;
  correct: number | null;
  total: number | null;
  pct: number;
  occurredAt: Date;
}

/** Unique per student: re-ingesting the same fact always produces the same key. */
export function evidenceDedupeKey(d: Pick<EvidenceDraft, 'source' | 'sourceRefId' | 'topicId' | 'chapterId' | 'conceptTag'>): string {
  const scope = d.topicId ? `t:${d.topicId}` : `c:${d.chapterId}`;
  return `${d.source}:${d.sourceRefId}:${scope}:${(d.conceptTag ?? '').trim().toLowerCase()}`;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function pctOf(correct: number, total: number): number | null {
  if (!(total > 0)) return null;
  return round2(Math.min(Math.max((correct / total) * 100, 0), 100));
}

function parseJsonArray(input: unknown): any[] {
  if (Array.isArray(input)) return input.filter(Boolean);
  if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Combine drafts that describe the same fact (same dedupe key): marks are
 * added up when every part has them, otherwise percentages are averaged by
 * question count (or equally when that is unknown).
 */
export function mergeDrafts(drafts: EvidenceDraft[]): EvidenceDraft[] {
  const groups = new Map<string, EvidenceDraft[]>();
  for (const d of drafts) {
    const key = evidenceDedupeKey(d);
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  return [...groups.values()].map((list) => {
    if (list.length === 1) return list[0];
    const occurredAt = new Date(Math.max(...list.map((d) => d.occurredAt.getTime())));
    const totals = list.map((d) => d.total);
    const allMarks = list.every((d) => d.correct !== null && d.total !== null && d.total > 0);
    if (allMarks) {
      const correct = list.reduce((s, d) => s + d.correct!, 0);
      const total = list.reduce((s, d) => s + d.total!, 0);
      return { ...list[0], correct: round2(correct), total: round2(total), pct: pctOf(correct, total)!, occurredAt };
    }
    const weights = totals.map((t) => (t && t > 0 ? t : 1));
    const weightSum = weights.reduce((s, w) => s + w, 0);
    const pct = list.reduce((s, d, i) => s + d.pct * weights[i], 0) / weightSum;
    const knownTotal = totals.every((t) => t !== null) ? totals.reduce((s, t) => s! + t!, 0) : null;
    return { ...list[0], correct: null, total: knownTotal, pct: round2(pct), occurredAt };
  });
}

export interface AssessmentResultRow {
  result_id: string;
  subject_id: string | null;
  chapter_id: string | null;
  chapter_ids: unknown;
  topic_id: string | null;
  percentage: unknown;
  marks_obtained: unknown;
  total_marks: unknown;
  occurred_at: unknown;
  grading_details: unknown;
  questions_json: unknown;
}

/** grading_details entries that carry a final mark (not still waiting for a teacher). */
const isScored = (d: any) => d && d.status !== 'pending' && num(d.total) !== null && num(d.total)! > 0 && num(d.marks) !== null;

/**
 * A published teacher-assessment result. When every scored question is
 * tagged with a topic, the result is split per topic from its per-question
 * marks; otherwise it counts once against the assessment's own topic tag, or
 * against each of its chapters. A subject-only assessment has nothing
 * topic-level to say and produces no evidence.
 */
export function mapAssessmentResult(row: AssessmentResultRow): EvidenceDraft[] {
  const occurredAt = toDate(row.occurred_at);
  if (!occurredAt) return [];
  const base = {
    source: 'assessment' as const,
    sourceRefId: String(row.result_id),
    subjectId: row.subject_id ?? null,
    conceptTag: null,
    occurredAt,
  };

  const questions = parseJsonArray(row.questions_json);
  const topicByQuestion = new Map<string, string>();
  for (const q of questions) {
    const topicId = q.topicId ?? q.topic_id;
    if (q.id !== undefined && topicId) topicByQuestion.set(String(q.id), String(topicId));
  }
  const scored = parseJsonArray(row.grading_details).filter(isScored);
  if (scored.length && scored.every((d) => topicByQuestion.has(String(d.questionId)))) {
    const perTopic = new Map<string, { correct: number; total: number }>();
    for (const d of scored) {
      const topicId = topicByQuestion.get(String(d.questionId))!;
      const agg = perTopic.get(topicId) ?? { correct: 0, total: 0 };
      agg.correct += num(d.marks)!;
      agg.total += num(d.total)!;
      perTopic.set(topicId, agg);
    }
    return [...perTopic.entries()].map(([topicId, agg]) => ({
      ...base,
      chapterId: null,
      topicId,
      correct: round2(agg.correct),
      total: round2(agg.total),
      pct: pctOf(agg.correct, agg.total)!,
    }));
  }

  const marks = num(row.marks_obtained);
  const totalMarks = num(row.total_marks);
  const pct = num(row.percentage) ?? (marks !== null && totalMarks ? pctOf(marks, totalMarks) : null);
  if (pct === null) return [];
  const size = questions.length || null;
  const common = { ...base, correct: null, total: size, pct: round2(Math.min(Math.max(pct, 0), 100)) };

  if (row.topic_id) return [{ ...common, chapterId: row.chapter_id ?? null, topicId: String(row.topic_id) }];
  const chapterIds = new Set<string>(
    [row.chapter_id, ...parseJsonArray(row.chapter_ids)].filter(Boolean).map((c) => String(typeof c === 'object' ? c.id : c)),
  );
  return [...chapterIds].map((chapterId) => ({ ...common, chapterId, topicId: null }));
}

export interface AssignmentAnswerRow {
  submission_id: string;
  subject_id: string | null;
  topic_id: string | null;
  question_marks: unknown;
  is_correct: boolean | null;
  marks_awarded: unknown;
  occurred_at: unknown;
}

/**
 * Graded answers of one or more individual submissions, combined per
 * (submission, topic). Answers whose question has no resolvable topic are
 * skipped: assignments carry no chapter tag to fall back on.
 */
export function mapAssignmentAnswers(rows: AssignmentAnswerRow[]): EvidenceDraft[] {
  const groups = new Map<string, { row: AssignmentAnswerRow; correct: number; total: number; occurredAt: Date }>();
  for (const r of rows) {
    const max = num(r.question_marks);
    const occurredAt = toDate(r.occurred_at);
    if (!r.topic_id || !max || max <= 0 || !occurredAt) continue;
    const awarded = num(r.marks_awarded) ?? (r.is_correct === true ? max : r.is_correct === false ? 0 : null);
    if (awarded === null) continue;
    const key = `${r.submission_id}:${r.topic_id}`;
    const g = groups.get(key) ?? { row: r, correct: 0, total: 0, occurredAt };
    g.correct += Math.min(Math.max(awarded, 0), max);
    g.total += max;
    if (occurredAt > g.occurredAt) g.occurredAt = occurredAt;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    source: 'assignment' as const,
    sourceRefId: String(g.row.submission_id),
    subjectId: g.row.subject_id ?? null,
    chapterId: null,
    topicId: String(g.row.topic_id),
    conceptTag: null,
    correct: round2(g.correct),
    total: round2(g.total),
    pct: pctOf(g.correct, g.total)!,
    occurredAt: g.occurredAt,
  }));
}

export interface AssignmentTotalRow {
  submission_id: string;
  subject_id: string | null;
  topic_id: string | null;
  question_marks: unknown;
  submission_marks: unknown;
  max_marks: unknown;
  occurred_at: unknown;
}

/**
 * A teacher-graded assignment with one total mark and no per-question
 * answers (written work). Its score counts for every topic its questions
 * cover, weighted by how many marks of the paper each topic carries.
 */
export function mapAssignmentTotals(rows: AssignmentTotalRow[]): EvidenceDraft[] {
  const bySubmission = new Map<string, AssignmentTotalRow[]>();
  for (const r of rows) {
    const list = bySubmission.get(r.submission_id) ?? [];
    list.push(r);
    bySubmission.set(r.submission_id, list);
  }
  const out: EvidenceDraft[] = [];
  for (const [submissionId, list] of bySubmission) {
    const first = list[0];
    const marks = num(first.submission_marks);
    const occurredAt = toDate(first.occurred_at);
    const paperMarks = list.reduce((s, r) => s + Math.max(0, num(r.question_marks) ?? 0), 0);
    const outOf = num(first.max_marks) || paperMarks;
    if (marks === null || !outOf || outOf <= 0 || !occurredAt) continue;
    const pct = pctOf(Math.min(Math.max(marks, 0), outOf), outOf)!;

    const marksByTopic = new Map<string, number>();
    for (const r of list) {
      if (!r.topic_id) continue;
      marksByTopic.set(r.topic_id, (marksByTopic.get(r.topic_id) ?? 0) + Math.max(0, num(r.question_marks) ?? 0));
    }
    for (const [topicId, topicMarks] of marksByTopic) {
      out.push({
        source: 'assignment',
        sourceRefId: String(submissionId),
        subjectId: first.subject_id ?? null,
        chapterId: null,
        topicId,
        conceptTag: null,
        correct: null,
        total: topicMarks > 0 ? round2(topicMarks) : null,
        pct,
        occurredAt,
      });
    }
  }
  return out;
}

export interface GameScoreRow {
  score_id: string;
  subject_id: string | null;
  chapter_id: string | null;
  total_questions: unknown;
  correct_answers: unknown;
  occurred_at: unknown;
}

/** A completed, non-flagged game: chapter-level evidence. */
export function mapGameScore(row: GameScoreRow): EvidenceDraft | null {
  const total = num(row.total_questions);
  const correct = num(row.correct_answers);
  const occurredAt = toDate(row.occurred_at);
  if (!row.chapter_id || !total || total <= 0 || correct === null || !occurredAt) return null;
  return {
    source: 'game',
    sourceRefId: String(row.score_id),
    subjectId: row.subject_id ?? null,
    chapterId: String(row.chapter_id),
    topicId: null,
    conceptTag: null,
    correct: Math.min(correct, total),
    total,
    pct: pctOf(Math.min(correct, total), total)!,
    occurredAt,
  };
}

export interface LegacyQuizAttemptRow {
  attempt_id: string;
  topic_id: string;
  accuracy: unknown;
  occurred_at: unknown;
}

/** An attempt from the old planner's AI quiz (kept in learning_legacy_quiz_attempts). */
export function mapLegacyQuizAttempt(row: LegacyQuizAttemptRow): EvidenceDraft | null {
  const accuracy = num(row.accuracy);
  const occurredAt = toDate(row.occurred_at);
  if (!row.topic_id || accuracy === null || !occurredAt) return null;
  return {
    source: 'ai_quiz_legacy',
    sourceRefId: String(row.attempt_id),
    subjectId: null,
    chapterId: null,
    topicId: String(row.topic_id),
    conceptTag: null,
    correct: null,
    total: null,
    pct: round2(Math.min(Math.max(accuracy, 0), 100)),
    occurredAt,
  };
}
