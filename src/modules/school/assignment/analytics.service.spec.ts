import { AnalyticsUnit, buildAnalytics } from './analytics.service';

const unit = (id: string, over: Partial<AnalyticsUnit> = {}): AnalyticsUnit => ({
  id,
  name: id,
  status: 'pending',
  marks: null,
  isLate: false,
  submittedAt: null,
  ...over,
});

describe('buildAnalytics', () => {
  it('counts submitted, pending, evaluated and awaiting evaluation', () => {
    const a = buildAnalytics(
      [
        unit('a', { status: 'graded', marks: 80, submittedAt: 'x' }),
        unit('b', { status: 'submitted', submittedAt: 'x' }),
        unit('c'),
        unit('d'),
      ],
      { isGroup: false, maxMarks: 100 },
    );
    expect(a.summary).toMatchObject({
      total: 4, submitted: 2, pending: 2, evaluated: 1, awaitingEvaluation: 1, submissionRate: 50,
    });
    expect(a.unitLabel).toBe('students');
  });

  it('averages only graded work and reports it as a percentage of max marks', () => {
    const a = buildAnalytics(
      [
        unit('a', { status: 'graded', marks: 8 }),
        unit('b', { status: 'graded', marks: 4 }),
        unit('c', { status: 'submitted' }),
      ],
      { isGroup: false, maxMarks: 10 },
    );
    expect(a.summary).toMatchObject({ avgMarks: 6, avgPercent: 60, highest: 8, lowest: 4 });
  });

  it('buckets scores and puts a perfect score in the top bucket', () => {
    const a = buildAnalytics(
      [
        unit('a', { status: 'graded', marks: 100 }),
        unit('b', { status: 'graded', marks: 0 }),
        unit('c', { status: 'graded', marks: 45 }),
      ],
      { isGroup: false, maxMarks: 100 },
    );
    expect(a.distribution.map((d) => d.count)).toEqual([1, 0, 1, 0, 1]);
  });

  it('counts late only among submitted units and labels groups', () => {
    const a = buildAnalytics(
      [unit('g1', { status: 'submitted', isLate: true }), unit('g2', { isLate: true })],
      { isGroup: true, maxMarks: 100 },
    );
    expect(a.summary.late).toBe(1);
    expect(a.unitLabel).toBe('groups');
  });

  it('handles an empty assignment and bad max marks', () => {
    const a = buildAnalytics([], { isGroup: false, maxMarks: 0 });
    expect(a.summary).toMatchObject({ total: 0, submissionRate: null, avgMarks: null, highest: null });
    expect(a.distribution.every((d) => d.count === 0)).toBe(true);
  });
});
