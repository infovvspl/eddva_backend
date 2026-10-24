import { EvidenceSource, MasteryConfig } from './mastery-config';

/**
 * Weak-topic detection. Pure functions only: no I/O, no clock reads (callers
 * pass `now`), so every rule here is unit-tested in mastery-engine.spec.ts.
 *
 *   amount_i   = sourceWeight × sizeFactor × spread
 *   weight_i   = amount_i × 0.5^(ageDays / halfLifeDays)
 *   mastery    = Σ(pct_i × weight_i) / Σ weight_i
 *   confidence = 1 − e^(−Σ amount_i / confidenceK)
 *
 * Age only decides which evidence the mastery leans on, never how sure we
 * are: a term test scored at 2% three months ago is still proof of a weak
 * chapter until newer scores say otherwise. (Measured on dev data, decaying
 * confidence too left real failures as "insufficient_data".)
 */

export interface EvidenceItem {
  source: EvidenceSource;
  /** Null for chapter-level evidence (e.g. a game or a chapter-tagged test). */
  topicId: string | null;
  chapterId: string | null;
  conceptTag?: string | null;
  /** Score as a percentage, 0..100. */
  pct: number;
  /** Questions (or marks) behind pct; null means "a full-size piece of evidence". */
  total?: number | null;
  occurredAt: Date;
}

export interface TopicRef {
  topicId: string;
  chapterId: string;
  subjectId: string;
  /** True when the student has never opened study material for this topic. */
  neverStudied?: boolean;
  /** Overrides studyTime.baseMinutes, e.g. from the length of the topic's lesson. */
  baseMinutes?: number | null;
}

export type MasteryStatus = 'not_assessed' | 'insufficient_data' | 'weak' | 'at_risk' | 'ok' | 'mastered';

export interface TopicMastery {
  topicId: string;
  chapterId: string;
  subjectId: string;
  /** Null when the topic has no evidence at all. */
  mastery: number | null;
  confidence: number;
  status: MasteryStatus;
  /** Recommended study minutes; 0 when no study is needed or nothing is known yet. */
  estMinutes: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/** How much evidence an item is, regardless of its age. */
export function evidenceAmount(item: EvidenceItem, cfg: MasteryConfig, spread = false): number {
  const sourceWeight = cfg.sourceWeights[item.source] ?? 0;
  const total = Number(item.total);
  const sizeFactor = Number.isFinite(total) && total > 0 ? Math.min(1, total / cfg.fullWeightQuestions) : 1;
  return sourceWeight * sizeFactor * (spread ? cfg.chapterSpreadFactor : 1);
}

/** How much an item counts towards mastery: its amount, faded by age. */
export function evidenceWeight(item: EvidenceItem, cfg: MasteryConfig, now: Date, spread = false): number {
  // A future-dated item (an assessment scheduled later than it was graded) is treated as current.
  const ageDays = Math.max(0, (now.getTime() - item.occurredAt.getTime()) / DAY_MS);
  return evidenceAmount(item, cfg, spread) * Math.pow(0.5, ageDays / cfg.halfLifeDays);
}

export function classifyStatus(mastery: number | null, confidence: number, cfg: MasteryConfig): MasteryStatus {
  if (mastery === null) return 'not_assessed';
  if (confidence < cfg.minConfidence) return 'insufficient_data';
  if (mastery < cfg.thresholds.weak) return 'weak';
  if (mastery < cfg.thresholds.atRisk) return 'at_risk';
  if (mastery < cfg.thresholds.mastered) return 'ok';
  return 'mastered';
}

/**
 * Minutes needed to bring a topic up to the "mastered" threshold:
 *   base × (1 + (target − mastery) / target) × (neverStudiedFactor if never studied)
 * clamped to [minMinutes, maxMinutes]. Zero when no study is needed or mastery is unknown.
 */
export function estimateStudyMinutes(
  mastery: number | null,
  cfg: MasteryConfig,
  opts: { neverStudied?: boolean; baseMinutes?: number | null } = {},
): number {
  const target = cfg.thresholds.mastered;
  if (mastery === null || mastery >= target) return 0;
  const base = opts.baseMinutes && opts.baseMinutes > 0 ? opts.baseMinutes : cfg.studyTime.baseMinutes;
  const gap = (target - Math.max(0, mastery)) / target;
  const raw = base * (1 + gap) * (opts.neverStudied ? cfg.studyTime.neverStudiedFactor : 1);
  return Math.round(Math.min(Math.max(raw, cfg.studyTime.minMinutes), cfg.studyTime.maxMinutes));
}

export function computeTopicMastery(
  topic: TopicRef,
  direct: EvidenceItem[],
  chapterLevel: EvidenceItem[],
  cfg: MasteryConfig,
  now: Date,
): TopicMastery {
  let weighted = 0;
  let weightSum = 0;
  let amountSum = 0;
  let lastEvidenceAt: Date | null = null;
  const consider = (item: EvidenceItem, spread: boolean) => {
    const pct = Number(item.pct);
    if (!Number.isFinite(pct)) return;
    const w = evidenceWeight(item, cfg, now, spread);
    if (w <= 0) return;
    weighted += Math.min(Math.max(pct, 0), 100) * w;
    weightSum += w;
    amountSum += evidenceAmount(item, cfg, spread);
    if (!lastEvidenceAt || item.occurredAt > lastEvidenceAt) lastEvidenceAt = item.occurredAt;
  };
  direct.forEach((e) => consider(e, false));
  chapterLevel.forEach((e) => consider(e, true));

  const mastery = weightSum > 0 ? round(weighted / weightSum, 2) : null;
  const confidence = round(1 - Math.exp(-amountSum / cfg.confidenceK), 3);
  const status = classifyStatus(mastery, confidence, cfg);
  const needsStudy = status === 'weak' || status === 'at_risk' || status === 'ok';

  return {
    topicId: topic.topicId,
    chapterId: topic.chapterId,
    subjectId: topic.subjectId,
    mastery,
    confidence,
    status,
    estMinutes: needsStudy
      ? estimateStudyMinutes(mastery, cfg, { neverStudied: topic.neverStudied, baseMinutes: topic.baseMinutes })
      : 0,
    evidenceCount: direct.length + chapterLevel.length,
    lastEvidenceAt,
  };
}

/**
 * Mastery for every topic in a student's curriculum. Topic-tagged evidence
 * counts only for its topic; chapter-level evidence (topicId null) is spread
 * over every topic of its chapter at chapterSpreadFactor. Evidence for topics
 * or chapters outside `topics` is ignored.
 */
export function computeStudentMastery(
  topics: TopicRef[],
  evidence: EvidenceItem[],
  cfg: MasteryConfig,
  now: Date,
): TopicMastery[] {
  const byTopic = new Map<string, EvidenceItem[]>();
  const byChapter = new Map<string, EvidenceItem[]>();
  for (const e of evidence) {
    if (e.topicId) {
      const list = byTopic.get(e.topicId) ?? [];
      list.push(e);
      byTopic.set(e.topicId, list);
    } else if (e.chapterId) {
      const list = byChapter.get(e.chapterId) ?? [];
      list.push(e);
      byChapter.set(e.chapterId, list);
    }
  }
  return topics.map((t) =>
    computeTopicMastery(t, byTopic.get(t.topicId) ?? [], byChapter.get(t.chapterId) ?? [], cfg, now),
  );
}

export interface ChapterRef {
  chapterId: string;
  subjectId: string;
}

export interface ChapterMastery {
  chapterId: string;
  subjectId: string;
  mastery: number | null;
  confidence: number;
  status: MasteryStatus;
  estMinutes: number;
  evidenceCount: number;
  weakTopics: number;
  atRiskTopics: number;
  /**
   * Status from the chapter-level evidence alone (games, chapter-tagged tests:
   * no topic). Weak here means the weakness is chapter-wide, not just in the
   * one topic a test happened to cover.
   */
  chapterLevelStatus: MasteryStatus;
  lastEvidenceAt: Date | null;
}

/**
 * Mastery per chapter, from every piece of evidence in the chapter at full
 * weight (topic-tagged and chapter-tagged alike). This is what still detects a
 * weak chapter when tests are only chapter-tagged, which is too thin to judge
 * any single topic. Study time is the sum of the chapter's topics, or, when no
 * topic has enough evidence of its own, an estimate from the chapter's mastery.
 */
export function computeChapterMastery(
  chapters: ChapterRef[],
  topicResults: TopicMastery[],
  evidence: EvidenceItem[],
  cfg: MasteryConfig,
  now: Date,
): ChapterMastery[] {
  const evidenceByChapter = new Map<string, EvidenceItem[]>();
  for (const e of evidence) {
    if (!e.chapterId) continue;
    const list = evidenceByChapter.get(e.chapterId) ?? [];
    list.push(e);
    evidenceByChapter.set(e.chapterId, list);
  }
  const topicsByChapter = new Map<string, TopicMastery[]>();
  for (const t of topicResults) {
    const list = topicsByChapter.get(t.chapterId) ?? [];
    list.push(t);
    topicsByChapter.set(t.chapterId, list);
  }

  return chapters.map((c) => {
    const pseudoTopic: TopicRef = { topicId: c.chapterId, chapterId: c.chapterId, subjectId: c.subjectId };
    const chapterEvidence = evidenceByChapter.get(c.chapterId) ?? [];
    const m = computeTopicMastery(pseudoTopic, chapterEvidence, [], cfg, now);
    const chapterLevel = computeTopicMastery(pseudoTopic, chapterEvidence.filter((e) => !e.topicId), [], cfg, now);
    const topics = topicsByChapter.get(c.chapterId) ?? [];
    const topicMinutes = topics.reduce((sum, t) => sum + t.estMinutes, 0);
    const needsStudy = m.status === 'weak' || m.status === 'at_risk' || m.status === 'ok';
    return {
      chapterId: c.chapterId,
      subjectId: c.subjectId,
      mastery: m.mastery,
      confidence: m.confidence,
      status: m.status,
      estMinutes: topicMinutes > 0 ? topicMinutes : needsStudy ? estimateStudyMinutes(m.mastery, cfg) : 0,
      evidenceCount: m.evidenceCount,
      weakTopics: topics.filter((t) => t.status === 'weak').length,
      atRiskTopics: topics.filter((t) => t.status === 'at_risk').length,
      chapterLevelStatus: chapterLevel.status,
      lastEvidenceAt: m.lastEvidenceAt,
    };
  });
}

export interface ConceptResponse {
  conceptTag: string | null | undefined;
  isCorrect: boolean;
}

export interface ConceptAccuracy {
  conceptTag: string;
  correct: number;
  total: number;
  accuracy: number;
}

/**
 * Concepts answered at least concepts.minQuestions times with accuracy below
 * concepts.weakBelow, weakest first. Tags are grouped case- and
 * whitespace-insensitively; the first spelling seen is kept for display.
 */
export function detectWeakConcepts(responses: ConceptResponse[], cfg: MasteryConfig): ConceptAccuracy[] {
  const groups = new Map<string, ConceptAccuracy>();
  for (const r of responses) {
    const label = String(r.conceptTag ?? '').trim().replace(/\s+/g, ' ');
    if (!label) continue;
    const key = label.toLowerCase();
    const g = groups.get(key) ?? { conceptTag: label, correct: 0, total: 0, accuracy: 0 };
    g.total += 1;
    if (r.isCorrect) g.correct += 1;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, accuracy: round((g.correct / g.total) * 100, 1) }))
    .filter((g) => g.total >= cfg.concepts.minQuestions && g.accuracy < cfg.concepts.weakBelow)
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
}
