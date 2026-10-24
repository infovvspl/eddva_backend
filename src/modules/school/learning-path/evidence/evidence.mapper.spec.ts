import {
  AssessmentResultRow,
  evidenceDedupeKey,
  mapAssessmentResult,
  mapAssignmentAnswers,
  mapAssignmentTotals,
  mapGameScore,
  mapLegacyQuizAttempt,
  mergeDrafts,
  pctOf,
} from './evidence.mapper';

const WHEN = '2026-10-01T10:00:00Z';

const result = (over: Partial<AssessmentResultRow>): AssessmentResultRow => ({
  result_id: 'r1',
  subject_id: 's1',
  chapter_id: null,
  chapter_ids: null,
  topic_id: null,
  percentage: '42.5',
  marks_obtained: '17',
  total_marks: '40',
  occurred_at: WHEN,
  grading_details: null,
  questions_json: null,
  ...over,
});

describe('pctOf', () => {
  it('computes and bounds a percentage, refusing a zero total', () => {
    expect(pctOf(3, 4)).toBe(75);
    expect(pctOf(5, 4)).toBe(100);
    expect(pctOf(1, 0)).toBeNull();
  });
});

describe('evidenceDedupeKey', () => {
  it('is stable and distinguishes topic, chapter and concept scope', () => {
    const base = { source: 'game' as const, sourceRefId: 'x', topicId: null, chapterId: 'c1', conceptTag: null };
    expect(evidenceDedupeKey(base)).toBe('game:x:c:c1:');
    expect(evidenceDedupeKey({ ...base, topicId: 't1' })).toBe('game:x:t:t1:');
    expect(evidenceDedupeKey({ ...base, conceptTag: ' Roots ' })).toBe('game:x:c:c1:roots');
  });
});

describe('mapAssessmentResult', () => {
  it('counts against the assessment topic tag', () => {
    expect(mapAssessmentResult(result({ topic_id: 't1', chapter_id: 'c1' }))).toEqual([
      expect.objectContaining({ source: 'assessment', sourceRefId: 'r1', topicId: 't1', chapterId: 'c1', pct: 42.5 }),
    ]);
  });

  it('counts once per tagged chapter when there is no topic tag', () => {
    const drafts = mapAssessmentResult(result({ chapter_id: 'c1', chapter_ids: '["c1","c2"]' }));
    expect(drafts.map((d) => d.chapterId).sort()).toEqual(['c1', 'c2']);
    expect(drafts.every((d) => d.topicId === null)).toBe(true);
  });

  it('falls back to marks when percentage is missing', () => {
    expect(mapAssessmentResult(result({ topic_id: 't1', percentage: null }))[0].pct).toBe(42.5);
  });

  it('produces nothing for a subject-only assessment or an undated result', () => {
    expect(mapAssessmentResult(result({}))).toEqual([]);
    expect(mapAssessmentResult(result({ topic_id: 't1', occurred_at: null }))).toEqual([]);
  });

  it('splits by topic when every scored question is topic-tagged', () => {
    const drafts = mapAssessmentResult(
      result({
        topic_id: 'tAssessment',
        questions_json: [
          { id: 'q1', topicId: 't1' },
          { id: 'q2', topicId: 't1' },
          { id: 'q3', topic_id: 't2' },
          { id: 'q4', topicId: 't2' },
        ],
        grading_details: [
          { questionId: 'q1', status: 'correct', marks: 2, total: 2 },
          { questionId: 'q2', status: 'wrong', marks: 0, total: 2 },
          { questionId: 'q3', status: 'ai_graded', marks: 3, total: 4 },
          { questionId: 'q4', status: 'pending', marks: 0, total: 4 },
        ],
      }),
    );
    expect(drafts).toEqual([
      expect.objectContaining({ topicId: 't1', correct: 2, total: 4, pct: 50 }),
      expect.objectContaining({ topicId: 't2', correct: 3, total: 4, pct: 75 }),
    ]);
  });

  it('uses the assessment tag when some scored questions are untagged', () => {
    const drafts = mapAssessmentResult(
      result({
        topic_id: 'tAssessment',
        questions_json: [{ id: 'q1', topicId: 't1' }, { id: 'q2' }],
        grading_details: [
          { questionId: 'q1', status: 'correct', marks: 1, total: 1 },
          { questionId: 'q2', status: 'wrong', marks: 0, total: 1 },
        ],
      }),
    );
    expect(drafts).toEqual([expect.objectContaining({ topicId: 'tAssessment', total: 2, pct: 42.5 })]);
  });
});

describe('mapAssignmentAnswers', () => {
  const answer = (over: Record<string, unknown>) => ({
    submission_id: 'sub1',
    subject_id: 's1',
    topic_id: 't1',
    question_marks: 2,
    is_correct: true,
    marks_awarded: null,
    occurred_at: WHEN,
    ...over,
  });

  it('combines answers per submission and topic', () => {
    const drafts = mapAssignmentAnswers([
      answer({}),
      answer({ is_correct: false }),
      answer({ topic_id: 't2', marks_awarded: 1.5, is_correct: null }),
    ]);
    expect(drafts).toEqual([
      expect.objectContaining({ source: 'assignment', sourceRefId: 'sub1', topicId: 't1', correct: 2, total: 4, pct: 50 }),
      expect.objectContaining({ topicId: 't2', correct: 1.5, total: 2, pct: 75 }),
    ]);
  });

  it('skips untagged, ungraded and zero-mark questions', () => {
    expect(
      mapAssignmentAnswers([
        answer({ topic_id: null }),
        answer({ is_correct: null, marks_awarded: null }),
        answer({ question_marks: 0 }),
      ]),
    ).toEqual([]);
  });

  it('never awards more than the question is worth', () => {
    expect(mapAssignmentAnswers([answer({ marks_awarded: 9 })])[0].pct).toBe(100);
  });
});

describe('mapAssignmentTotals', () => {
  const q = (topic_id: string | null, question_marks: number, over: Record<string, unknown> = {}) => ({
    submission_id: 'sub9', subject_id: 's1', topic_id, question_marks, submission_marks: 15, max_marks: 20, occurred_at: WHEN, ...over,
  });

  it('counts a written assignment total for each topic its questions cover', () => {
    const drafts = mapAssignmentTotals([q('t1', 10), q('t1', 5), q('t2', 5), q(null, 0)]);
    expect(drafts).toEqual([
      expect.objectContaining({ source: 'assignment', sourceRefId: 'sub9', topicId: 't1', pct: 75, total: 15, correct: null }),
      expect.objectContaining({ topicId: 't2', pct: 75, total: 5 }),
    ]);
  });

  it('falls back to the sum of question marks when the assignment has no maximum', () => {
    expect(mapAssignmentTotals([q('t1', 10, { max_marks: null, submission_marks: 4 }), q('t1', 10, { max_marks: null, submission_marks: 4 })])[0].pct).toBe(20);
  });

  it('skips ungraded or untagged work and never exceeds 100%', () => {
    expect(mapAssignmentTotals([q('t1', 5, { submission_marks: null })])).toEqual([]);
    expect(mapAssignmentTotals([q(null, 5)])).toEqual([]);
    expect(mapAssignmentTotals([q('t1', 5, { submission_marks: 99 })])[0].pct).toBe(100);
  });
});

describe('mapGameScore', () => {
  it('maps a chapter game to chapter-level evidence', () => {
    expect(
      mapGameScore({ score_id: 'g1', subject_id: 's1', chapter_id: 'c1', total_questions: 10, correct_answers: 7, occurred_at: WHEN }),
    ).toEqual(expect.objectContaining({ source: 'game', chapterId: 'c1', topicId: null, correct: 7, total: 10, pct: 70 }));
  });

  it('ignores games without a chapter or questions', () => {
    expect(mapGameScore({ score_id: 'g', subject_id: 's', chapter_id: null, total_questions: 10, correct_answers: 1, occurred_at: WHEN })).toBeNull();
    expect(mapGameScore({ score_id: 'g', subject_id: 's', chapter_id: 'c', total_questions: 0, correct_answers: 0, occurred_at: WHEN })).toBeNull();
  });
});

describe('mergeDrafts', () => {
  const base = { source: 'assessment' as const, sourceRefId: 'r1', subjectId: 's', chapterId: 'c', topicId: 'rt1', conceptTag: null };

  it('adds up marks of parts that landed on the same roadmap topic', () => {
    const merged = mergeDrafts([
      { ...base, correct: 2, total: 4, pct: 50, occurredAt: new Date(WHEN) },
      { ...base, correct: 4, total: 4, pct: 100, occurredAt: new Date('2026-10-02T00:00:00Z') },
    ]);
    expect(merged).toEqual([expect.objectContaining({ correct: 6, total: 8, pct: 75, occurredAt: new Date('2026-10-02T00:00:00Z') })]);
  });

  it('averages percentages by size when marks are missing', () => {
    const merged = mergeDrafts([
      { ...base, correct: null, total: 30, pct: 40, occurredAt: new Date(WHEN) },
      { ...base, correct: null, total: 10, pct: 80, occurredAt: new Date(WHEN) },
    ]);
    expect(merged).toEqual([expect.objectContaining({ pct: 50, total: 40, correct: null })]);
  });

  it('keeps different facts apart', () => {
    expect(
      mergeDrafts([
        { ...base, correct: 1, total: 2, pct: 50, occurredAt: new Date(WHEN) },
        { ...base, topicId: 'rt2', correct: 1, total: 2, pct: 50, occurredAt: new Date(WHEN) },
      ]),
    ).toHaveLength(2);
  });
});

describe('mapLegacyQuizAttempt', () => {
  it('maps an old planner quiz attempt to topic evidence', () => {
    expect(mapLegacyQuizAttempt({ attempt_id: 'a1', topic_id: 't1', accuracy: 63, occurred_at: WHEN })).toEqual(
      expect.objectContaining({ source: 'ai_quiz_legacy', topicId: 't1', pct: 63, total: null }),
    );
  });

  it('rejects incomplete rows', () => {
    expect(mapLegacyQuizAttempt({ attempt_id: 'a1', topic_id: 't1', accuracy: null, occurred_at: WHEN })).toBeNull();
  });
});
