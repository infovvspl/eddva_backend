import { DEFAULT_MASTERY_CONFIG, resolveMasteryConfig } from './mastery-config';
import {
  classifyStatus,
  computeChapterMastery,
  computeStudentMastery,
  computeTopicMastery,
  detectWeakConcepts,
  estimateStudyMinutes,
  EvidenceItem,
  evidenceWeight,
  TopicRef,
} from './mastery-engine';

const cfg = DEFAULT_MASTERY_CONFIG;
const NOW = new Date('2026-10-22T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

const topic: TopicRef = { topicId: 't1', chapterId: 'c1', subjectId: 's1' };
const ev = (over: Partial<EvidenceItem>): EvidenceItem => ({
  source: 'assessment',
  topicId: 't1',
  chapterId: 'c1',
  pct: 50,
  total: null,
  occurredAt: NOW,
  ...over,
});

describe('evidenceWeight', () => {
  it('uses the source weight for fresh, full-size evidence', () => {
    expect(evidenceWeight(ev({ source: 'assessment' }), cfg, NOW)).toBeCloseTo(1);
    expect(evidenceWeight(ev({ source: 'game' }), cfg, NOW)).toBeCloseTo(0.3);
  });

  it('halves every half-life', () => {
    expect(evidenceWeight(ev({ occurredAt: daysAgo(30) }), cfg, NOW)).toBeCloseTo(0.5);
    expect(evidenceWeight(ev({ occurredAt: daysAgo(60) }), cfg, NOW)).toBeCloseTo(0.25);
  });

  it('treats future-dated evidence as current', () => {
    expect(evidenceWeight(ev({ occurredAt: daysAgo(-10) }), cfg, NOW)).toBeCloseTo(1);
  });

  it('scales down evidence from only a few questions', () => {
    expect(evidenceWeight(ev({ total: 1 }), cfg, NOW)).toBeCloseTo(0.2);
    expect(evidenceWeight(ev({ total: 20 }), cfg, NOW)).toBeCloseTo(1);
  });

  it('applies the chapter spread factor', () => {
    expect(evidenceWeight(ev({}), cfg, NOW, true)).toBeCloseTo(0.5);
  });
});

describe('classifyStatus', () => {
  it.each([
    [null, 0, 'not_assessed'],
    [20, 0.2, 'insufficient_data'],
    [49.9, 0.9, 'weak'],
    [50, 0.9, 'at_risk'],
    [69.9, 0.9, 'at_risk'],
    [70, 0.9, 'ok'],
    [85, 0.9, 'mastered'],
  ])('mastery %p with confidence %p is %p', (mastery, confidence, status) => {
    expect(classifyStatus(mastery as number | null, confidence as number, cfg)).toBe(status);
  });
});

describe('estimateStudyMinutes', () => {
  it('needs no study once mastered or when nothing is known', () => {
    expect(estimateStudyMinutes(85, cfg)).toBe(0);
    expect(estimateStudyMinutes(null, cfg)).toBe(0);
  });

  it('doubles the base time at zero mastery', () => {
    expect(estimateStudyMinutes(0, cfg)).toBe(60);
  });

  it('scales with the gap to the target', () => {
    // 30 × (1 + 35/85) = 42.35
    expect(estimateStudyMinutes(50, cfg)).toBe(42);
  });

  it('adds time for a topic never studied and honours a lesson-based base', () => {
    expect(estimateStudyMinutes(50, cfg, { neverStudied: true })).toBe(51);
    expect(estimateStudyMinutes(50, cfg, { baseMinutes: 60 })).toBe(85);
  });

  it('clamps to the configured range', () => {
    expect(estimateStudyMinutes(84, cfg, { baseMinutes: 5 })).toBe(cfg.studyTime.minMinutes);
    expect(estimateStudyMinutes(0, cfg, { baseMinutes: 200, neverStudied: true })).toBe(cfg.studyTime.maxMinutes);
  });
});

describe('computeTopicMastery', () => {
  it('reports not_assessed with no evidence', () => {
    const m = computeTopicMastery(topic, [], [], cfg, NOW);
    expect(m).toMatchObject({ mastery: null, confidence: 0, status: 'not_assessed', estMinutes: 0, evidenceCount: 0 });
  });

  it('weights a teacher assessment above a game', () => {
    const m = computeTopicMastery(
      topic,
      [ev({ source: 'assessment', pct: 40 }), ev({ source: 'game', pct: 100 })],
      [],
      cfg,
      NOW,
    );
    // (40×1 + 100×0.3) / 1.3 = 53.85
    expect(m.mastery).toBeCloseTo(53.85, 2);
    expect(m.status).toBe('at_risk');
  });

  it('lets recent evidence outweigh old evidence', () => {
    const m = computeTopicMastery(
      topic,
      [ev({ pct: 90, occurredAt: daysAgo(90) }), ev({ pct: 30, occurredAt: NOW })],
      [],
      cfg,
      NOW,
    );
    // (90×0.125 + 30×1) / 1.125 = 36.67
    expect(m.mastery).toBeCloseTo(36.67, 2);
    expect(m.status).toBe('weak');
    expect(m.lastEvidenceAt).toEqual(NOW);
  });

  it('never flags a topic weak from too little evidence', () => {
    const m = computeTopicMastery(topic, [ev({ source: 'game', pct: 0, total: 2 })], [], cfg, NOW);
    expect(m.mastery).toBe(0);
    expect(m.status).toBe('insufficient_data');
    expect(m.estMinutes).toBe(0);
  });

  it('ignores invalid scores and clamps out-of-range ones', () => {
    const m = computeTopicMastery(topic, [ev({ pct: NaN }), ev({ pct: 140 })], [], cfg, NOW);
    expect(m.mastery).toBe(100);
  });

  it('recommends study time for weak topics', () => {
    const m = computeTopicMastery({ ...topic, neverStudied: true }, [ev({ pct: 20 }), ev({ pct: 30 })], [], cfg, NOW);
    expect(m.status).toBe('weak');
    expect(m.estMinutes).toBeGreaterThan(0);
  });
});

describe('computeStudentMastery', () => {
  const topics: TopicRef[] = [
    { topicId: 't1', chapterId: 'c1', subjectId: 's1' },
    { topicId: 't2', chapterId: 'c1', subjectId: 's1' },
    { topicId: 't3', chapterId: 'c2', subjectId: 's1' },
  ];

  it('spreads chapter-level evidence over every topic of that chapter only', () => {
    const result = computeStudentMastery(
      topics,
      [ev({ topicId: null, chapterId: 'c1', pct: 40 }), ev({ topicId: null, chapterId: 'c1', pct: 40 })],
      cfg,
      NOW,
    );
    const byId = Object.fromEntries(result.map((r) => [r.topicId, r]));
    expect(byId.t1.mastery).toBe(40);
    expect(byId.t2.mastery).toBe(40);
    expect(byId.t3.status).toBe('not_assessed');
  });

  it('combines topic and chapter evidence, with topic evidence counting more', () => {
    const result = computeStudentMastery(
      topics,
      [ev({ topicId: 't1', pct: 80 }), ev({ topicId: null, chapterId: 'c1', pct: 20 })],
      cfg,
      NOW,
    );
    // (80×1 + 20×0.5) / 1.5 = 60
    expect(result.find((r) => r.topicId === 't1')!.mastery).toBe(60);
    expect(result.find((r) => r.topicId === 't2')!.mastery).toBe(20);
  });

  it('ignores evidence for topics outside the curriculum', () => {
    const result = computeStudentMastery(topics, [ev({ topicId: 'other', chapterId: 'cX' })], cfg, NOW);
    expect(result.every((r) => r.status === 'not_assessed')).toBe(true);
  });
});

describe('confidence calibration', () => {
  it('lets one full, fresh teacher assessment flag a topic', () => {
    expect(computeTopicMastery(topic, [ev({ pct: 20 })], [], cfg, NOW).status).toBe('weak');
  });

  it('keeps an old failing term test as enough evidence when nothing newer exists', () => {
    const m = computeTopicMastery(topic, [ev({ pct: 2, total: 30, occurredAt: daysAgo(80) })], [], cfg, NOW);
    expect(m.confidence).toBeCloseTo(0.393, 3);
    expect(m.status).toBe('weak');
  });

  it('lets newer evidence decide the mastery without changing how sure we are', () => {
    const old = ev({ pct: 10, occurredAt: daysAgo(120) });
    const fresh = ev({ pct: 90, occurredAt: NOW });
    const m = computeTopicMastery(topic, [old, fresh], [], cfg, NOW);
    expect(m.mastery).toBeGreaterThan(80);
    expect(m.confidence).toBeCloseTo(1 - Math.exp(-1), 3);
  });

  it('does not let a single game, AI quiz or assignment flag a topic', () => {
    for (const source of ['game', 'ai_quiz', 'assignment'] as const) {
      expect(computeTopicMastery(topic, [ev({ source, pct: 0 })], [], cfg, NOW).status).toBe('insufficient_data');
    }
  });
});

describe('computeChapterMastery', () => {
  const topics: TopicRef[] = [
    { topicId: 't1', chapterId: 'c1', subjectId: 's1' },
    { topicId: 't2', chapterId: 'c1', subjectId: 's1' },
  ];
  const chapters = [
    { chapterId: 'c1', subjectId: 's1' },
    { chapterId: 'c2', subjectId: 's1' },
  ];

  it('flags a weak chapter from one chapter-tagged test that is too thin for any topic', () => {
    const evidence = [ev({ topicId: null, chapterId: 'c1', pct: 30 })];
    const topicResults = computeStudentMastery(topics, evidence, cfg, NOW);
    expect(topicResults.every((t) => t.status === 'insufficient_data')).toBe(true);

    const [c1, c2] = computeChapterMastery(chapters, topicResults, evidence, cfg, NOW);
    expect(c1).toMatchObject({ mastery: 30, status: 'weak', weakTopics: 0, evidenceCount: 1 });
    expect(c1.estMinutes).toBe(estimateStudyMinutes(30, cfg));
    expect(c2.status).toBe('not_assessed');
  });

  it("records the chapter-level marks' own status, apart from topic marks", () => {
    // one topic test (weak) and a chapter-level game (fine): weak only in that topic
    const narrow = [ev({ topicId: 't1', pct: 15 }), ev({ topicId: null, source: 'game', pct: 90 })];
    const [c1] = computeChapterMastery(chapters, computeStudentMastery(topics, narrow, cfg, NOW), narrow, cfg, NOW);
    expect(c1.status).toBe('weak');
    expect(['weak', 'at_risk']).not.toContain(c1.chapterLevelStatus); // one light game: not enough to call it weak
    // a chapter-level test that is weak: weak across the chapter
    const wide = [ev({ topicId: null, pct: 25 })];
    const [w] = computeChapterMastery(chapters, computeStudentMastery(topics, wide, cfg, NOW), wide, cfg, NOW);
    expect(w.chapterLevelStatus).toBe('weak');
    // only topic marks: nothing chapter-level
    const topicOnly = [ev({ topicId: 't1', pct: 15 })];
    const [t] = computeChapterMastery(chapters, computeStudentMastery(topics, topicOnly, cfg, NOW), topicOnly, cfg, NOW);
    expect(t).toMatchObject({ status: 'weak', chapterLevelStatus: 'not_assessed' });
  });

  it('counts topic evidence at full weight and sums topic study time', () => {
    const evidence = [ev({ topicId: 't1', pct: 20 }), ev({ topicId: 't2', pct: 60 })];
    const topicResults = computeStudentMastery(topics, evidence, cfg, NOW);
    const [c1] = computeChapterMastery(chapters, topicResults, evidence, cfg, NOW);
    expect(c1.mastery).toBe(40);
    expect(c1).toMatchObject({ weakTopics: 1, atRiskTopics: 1 });
    expect(c1.estMinutes).toBe(topicResults[0].estMinutes + topicResults[1].estMinutes);
  });
});

describe('detectWeakConcepts', () => {
  it('returns concepts below the threshold with enough answers, weakest first', () => {
    const weak = detectWeakConcepts(
      [
        { conceptTag: 'Discriminant', isCorrect: false },
        { conceptTag: 'discriminant ', isCorrect: false },
        { conceptTag: 'Discriminant', isCorrect: true },
        { conceptTag: 'Roots', isCorrect: false },
        { conceptTag: 'Roots', isCorrect: true },
        { conceptTag: 'Factorisation', isCorrect: true },
        { conceptTag: 'Factorisation', isCorrect: true },
        { conceptTag: 'Graphs', isCorrect: false },
        { conceptTag: null, isCorrect: false },
      ],
      cfg,
    );
    expect(weak).toEqual([
      { conceptTag: 'Discriminant', correct: 1, total: 3, accuracy: 33.3 },
      { conceptTag: 'Roots', correct: 1, total: 2, accuracy: 50 },
    ]);
  });
});

describe('resolveMasteryConfig', () => {
  it('returns the defaults for a missing or malformed override', () => {
    expect(resolveMasteryConfig(undefined)).toEqual(DEFAULT_MASTERY_CONFIG);
    expect(resolveMasteryConfig('nonsense')).toEqual(DEFAULT_MASTERY_CONFIG);
  });

  it('applies a partial override and keeps the rest', () => {
    const c = resolveMasteryConfig({ thresholds: { weak: 40 }, sourceWeights: { game: 0.1 } });
    expect(c.thresholds).toEqual({ weak: 40, atRisk: 70, mastered: 85 });
    expect(c.sourceWeights.game).toBe(0.1);
    expect(c.sourceWeights.assessment).toBe(1);
  });

  it('keeps thresholds ordered and values in range', () => {
    const c = resolveMasteryConfig({ thresholds: { weak: 80, atRisk: 60, mastered: 10 }, sourceWeights: { game: 7 } });
    expect(c.thresholds.weak).toBe(80);
    expect(c.thresholds.atRisk).toBeGreaterThanOrEqual(80);
    expect(c.thresholds.mastered).toBeGreaterThanOrEqual(c.thresholds.atRisk);
    expect(c.sourceWeights.game).toBe(1);
  });
});
