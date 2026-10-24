import {
  averageImprovement,
  bucketOf,
  buildTrend,
  effortWithoutGain,
  engagementLevel,
  engagementScore,
  isInactive,
  PERIOD_DAYS,
  periodStart,
  trendBuckets,
} from './report-metrics';

describe('engagementScore', () => {
  it('is full marks at 3 active days, 90 minutes and 2 steps a week', () => {
    expect(engagementScore({ activeDays: 3, seconds: 90 * 60, stepsDone: 2 }, 7)).toBe(100);
    expect(engagementScore({ activeDays: 7, seconds: 600 * 60, stepsDone: 10 }, 7)).toBe(100); // capped
  });

  it('weighs consistency 40, time 40 and progress 20', () => {
    expect(engagementScore({ activeDays: 3, seconds: 0, stepsDone: 0 }, 7)).toBe(40);
    expect(engagementScore({ activeDays: 0, seconds: 90 * 60, stepsDone: 0 }, 7)).toBe(40);
    expect(engagementScore({ activeDays: 0, seconds: 0, stepsDone: 2 }, 7)).toBe(20);
    expect(engagementScore({ activeDays: 0, seconds: 0, stepsDone: 0 }, 7)).toBe(0);
  });

  it('scales the targets to the period', () => {
    // one week's worth of study spread over a month is a quarter of the month's target
    const month = engagementScore({ activeDays: 3, seconds: 90 * 60, stepsDone: 2 }, 28);
    expect(month).toBe(25);
  });

  it('names the level', () => {
    expect(engagementLevel(70)).toBe('high');
    expect(engagementLevel(69)).toBe('medium');
    expect(engagementLevel(40)).toBe('medium');
    expect(engagementLevel(39)).toBe('low');
  });
});

describe('isInactive', () => {
  it('is inactive after 7 days without study, or with none at all', () => {
    expect(isInactive(null, '2026-10-24')).toBe(true);
    expect(isInactive('2026-10-17', '2026-10-24')).toBe(true);
    expect(isInactive('2026-10-18', '2026-10-24')).toBe(false);
    expect(isInactive('2026-10-24', '2026-10-24')).toBe(false);
  });
});

describe('improvement', () => {
  it('averages over topics measured again, ignoring the rest', () => {
    expect(averageImprovement([{ baseline: 20, latest: 50 }, { baseline: 40, latest: 45 }, { baseline: 30, latest: null }])).toBe(17.5);
    expect(averageImprovement([{ baseline: null, latest: 60 }])).toBeNull();
    expect(averageImprovement([])).toBeNull();
  });

  it('flags an hour or more of study with 2 points of improvement or less', () => {
    expect(effortWithoutGain(60 * 60, 2)).toBe(true);
    expect(effortWithoutGain(60 * 60, -5)).toBe(true);
    expect(effortWithoutGain(59 * 60, 0)).toBe(false); // not enough time to judge
    expect(effortWithoutGain(120 * 60, 2.5)).toBe(false); // improving
    expect(effortWithoutGain(120 * 60, null)).toBe(false); // not measured yet
  });
});

describe('periods and trends', () => {
  it('starts a period so it includes today', () => {
    expect(periodStart('2026-10-24', 'today')).toBe('2026-10-24'); // just today
    expect(periodStart('2026-10-24', 'week')).toBe('2026-10-18');
    expect(periodStart('2026-10-24', 'month')).toBe('2026-09-25');
  });

  it("'today' is a one-day period", () => {
    expect(PERIOD_DAYS.today).toBe(1);
  });

  it('puts a day in its bucket (weeks start on Monday)', () => {
    expect(bucketOf('2026-10-24', 'day')).toBe('2026-10-24');
    expect(bucketOf('2026-10-24', 'week')).toBe('2026-10-19'); // a Saturday -> its Monday
    expect(bucketOf('2026-10-19', 'week')).toBe('2026-10-19');
    expect(bucketOf('2026-10-24', 'month')).toBe('2026-10-01');
    expect(bucketOf('2026-10-24', 'year')).toBe('2026-01-01');
  });

  it('lists every bucket of the window, oldest first', () => {
    expect(trendBuckets('2026-10-24', 'day')).toHaveLength(30);
    expect(trendBuckets('2026-10-24', 'week').slice(-2)).toEqual(['2026-10-12', '2026-10-19']);
    expect(trendBuckets('2026-10-24', 'month')).toEqual(expect.arrayContaining(['2025-11-01', '2026-10-01']));
    expect(trendBuckets('2026-10-24', 'month')).toHaveLength(12);
    expect(trendBuckets('2026-10-24', 'year')).toEqual(['2022-01-01', '2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01']);
  });

  it('sums usage into buckets, counts each active student once, and fills the gaps', () => {
    const trend = buildTrend(
      [
        { day: '2026-10-20', studentId: 'a', seconds: 600 },
        { day: '2026-10-21', studentId: 'a', seconds: 300 },
        { day: '2026-10-22', studentId: 'b', seconds: 120 },
        { day: '2026-10-05', studentId: 'c', seconds: 60 },
        { day: '2020-01-01', studentId: 'd', seconds: 999 }, // outside the window
      ],
      '2026-10-24',
      'week',
    );
    expect(trend).toHaveLength(12);
    expect(trend[11]).toEqual({ period: '2026-10-19', seconds: 1020, activeStudents: 2 });
    expect(trend[9]).toEqual({ period: '2026-10-05', seconds: 60, activeStudents: 1 });
    expect(trend[10]).toEqual({ period: '2026-10-12', seconds: 0, activeStudents: 0 });
  });
});
