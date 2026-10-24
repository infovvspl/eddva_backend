/**
 * Tunables for weak-topic detection. Every institute starts from
 * DEFAULT_MASTERY_CONFIG and may override any part of it through
 * learning_path_settings.config; resolveMasteryConfig() merges and clamps the
 * override so a bad settings row can never produce nonsense statuses.
 */

export const EVIDENCE_SOURCES = [
  'assessment',
  'ai_assessment',
  'assignment',
  'ai_quiz',
  'ai_quiz_legacy',
  'game',
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * Sources rebuilt from other modules' tables on every ingest. ai_quiz and
 * ai_assessment are written directly by the learning path's own quiz engine
 * and are never deleted by a rebuild.
 */
export const DERIVED_SOURCES: EvidenceSource[] = ['assessment', 'assignment', 'game', 'ai_quiz_legacy'];

export interface MasteryConfig {
  /** How much one piece of evidence from each source counts. */
  sourceWeights: Record<EvidenceSource, number>;
  /** Chapter-tagged evidence is spread over the chapter's topics at this fraction of its weight. */
  chapterSpreadFactor: number;
  /** Evidence loses half its weight every halfLifeDays. */
  halfLifeDays: number;
  /** confidence = 1 - e^(-effectiveN / confidenceK). */
  confidenceK: number;
  /** Below this confidence a topic is "insufficient_data" and never flagged weak. */
  minConfidence: number;
  /** A question-count below this scales an evidence item down (1 question counts 1/fullWeightQuestions). */
  fullWeightQuestions: number;
  thresholds: {
    /** mastery < weak -> weak */
    weak: number;
    /** weak <= mastery < atRisk -> at_risk */
    atRisk: number;
    /** atRisk <= mastery < mastered -> ok; above -> mastered */
    mastered: number;
  };
  studyTime: {
    baseMinutes: number;
    minMinutes: number;
    maxMinutes: number;
    neverStudiedFactor: number;
  };
  concepts: {
    /** A concept needs at least this many answered questions before it can be called weak. */
    minQuestions: number;
    /** Concept accuracy below this (percent) is weak. */
    weakBelow: number;
  };
}

export const DEFAULT_MASTERY_CONFIG: MasteryConfig = {
  sourceWeights: {
    assessment: 1.0,
    ai_assessment: 0.9,
    assignment: 0.7,
    ai_quiz: 0.5,
    ai_quiz_legacy: 0.5,
    game: 0.3,
  },
  chapterSpreadFactor: 0.5,
  halfLifeDays: 30,
  // 2 lets one full, fresh teacher assessment (confidence 0.39) flag a topic on its own,
  // while a single game, AI quiz or assignment (0.14 to 0.30) cannot.
  confidenceK: 2,
  minConfidence: 0.35,
  fullWeightQuestions: 5,
  thresholds: { weak: 50, atRisk: 70, mastered: 85 },
  studyTime: { baseMinutes: 30, minMinutes: 20, maxMinutes: 150, neverStudiedFactor: 1.2 },
  concepts: { minQuestions: 2, weakBelow: 60 },
};

const clamp = (n: unknown, min: number, max: number, fallback: number): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(v, min), max);
};

/** Merge an institute override (any shape, possibly partial or malformed) onto the defaults. */
export function resolveMasteryConfig(override?: any): MasteryConfig {
  const d = DEFAULT_MASTERY_CONFIG;
  const o = override && typeof override === 'object' ? override : {};
  const ow = o.sourceWeights ?? {};
  const ot = o.thresholds ?? {};
  const os = o.studyTime ?? {};
  const oc = o.concepts ?? {};

  const sourceWeights = {} as Record<EvidenceSource, number>;
  for (const s of EVIDENCE_SOURCES) sourceWeights[s] = clamp(ow[s], 0, 1, d.sourceWeights[s]);

  const weak = clamp(ot.weak, 1, 99, d.thresholds.weak);
  const atRisk = clamp(ot.atRisk, weak, 99, Math.max(d.thresholds.atRisk, weak));
  const mastered = clamp(ot.mastered, atRisk, 100, Math.max(d.thresholds.mastered, atRisk));

  const minMinutes = clamp(os.minMinutes, 5, 600, d.studyTime.minMinutes);
  const maxMinutes = clamp(os.maxMinutes, minMinutes, 600, Math.max(d.studyTime.maxMinutes, minMinutes));

  return {
    sourceWeights,
    chapterSpreadFactor: clamp(o.chapterSpreadFactor, 0, 1, d.chapterSpreadFactor),
    halfLifeDays: clamp(o.halfLifeDays, 1, 365, d.halfLifeDays),
    confidenceK: clamp(o.confidenceK, 0.5, 20, d.confidenceK),
    minConfidence: clamp(o.minConfidence, 0, 0.99, d.minConfidence),
    fullWeightQuestions: clamp(o.fullWeightQuestions, 1, 100, d.fullWeightQuestions),
    thresholds: { weak, atRisk, mastered },
    studyTime: {
      baseMinutes: clamp(os.baseMinutes, 5, 300, d.studyTime.baseMinutes),
      minMinutes,
      maxMinutes,
      neverStudiedFactor: clamp(os.neverStudiedFactor, 1, 3, d.studyTime.neverStudiedFactor),
    },
    concepts: {
      minQuestions: clamp(oc.minQuestions, 1, 50, d.concepts.minQuestions),
      weakBelow: clamp(oc.weakBelow, 1, 100, d.concepts.weakBelow),
    },
  };
}
