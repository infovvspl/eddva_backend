/**
 * How the study-planner reports judge engagement and progress. Pure, so the
 * rules are unit-tested and the same everywhere (admin, teacher, parent).
 *
 * Engagement score, 0–100, over the chosen period:
 * - consistency (40): active days, full marks at 3 days a week;
 * - time (40): minutes studied, full marks at 90 minutes a week;
 * - progress (20): path steps finished (video, notes, quiz, assessment),
 *   full marks at 2 a week.
 * 70+ is high, 40–69 medium, below 40 low. A student with no study in the
 * last 7 days is inactive, whatever the period.
 *
 * Time against improvement: a student who put in real time (an hour or more
 * in the period) whose measured improvement is small (2 points or less) is
 * flagged, so effort that is not paying off gets noticed.
 */

export type ReportPeriod = 'today' | 'week' | 'month' | 'year';
export type TrendGranularity = 'day' | 'week' | 'month' | 'year';
export type EngagementLevel = 'high' | 'medium' | 'low';

export const PERIOD_DAYS: Record<ReportPeriod, number> = { today: 1, week: 7, month: 30, year: 365 };

export const ENGAGEMENT = {
  activeDaysPerWeek: 3,
  minutesPerWeek: 90,
  stepsPerWeek: 2,
  weights: { consistency: 40, time: 40, progress: 20 },
  high: 70,
  medium: 40,
  inactiveAfterDays: 7,
} as const;

export const EFFORT_WITHOUT_GAIN = { minMinutes: 60, maxImprovement: 2 } as const;

/** How far back a usage trend goes, in buckets of its granularity — the cap
 *  used when the natural window for the period would be unreadably wide. */
export const TREND_BUCKETS: Record<TrendGranularity, number> = { day: 30, week: 12, month: 12, year: 5 };

const BUCKET_DAYS: Record<TrendGranularity, number> = { day: 1, week: 7, month: 30, year: 365 };

/**
 * How many buckets the trend chart should show so its window actually matches
 * the selected period (e.g. "Today" shows 1 bucket, not the same fixed 30-day
 * window as "Last 30 days"), capped at TREND_BUCKETS so a long period paired
 * with a fine granularity doesn't produce an unreadable chart.
 */
export function trendBucketCount(period: ReportPeriod, granularity: TrendGranularity): number {
  const natural = Math.ceil(PERIOD_DAYS[period] / BUCKET_DAYS[granularity]);
  return Math.max(1, Math.min(TREND_BUCKETS[granularity], natural));
}

export interface StudentActivity {
  seconds: number;
  activeDays: number;
  stepsDone: number;
}

export function engagementScore(a: StudentActivity, periodDays: number): number {
  const weeks = Math.max(1, periodDays) / 7;
  const share = (value: number, perWeek: number) => Math.min(1, value / (perWeek * weeks));
  const w = ENGAGEMENT.weights;
  const score =
    w.consistency * share(a.activeDays, ENGAGEMENT.activeDaysPerWeek) +
    w.time * share(a.seconds / 60, ENGAGEMENT.minutesPerWeek) +
    w.progress * share(a.stepsDone, ENGAGEMENT.stepsPerWeek);
  return Math.round(score);
}

export function engagementLevel(score: number): EngagementLevel {
  if (score >= ENGAGEMENT.high) return 'high';
  if (score >= ENGAGEMENT.medium) return 'medium';
  return 'low';
}

/** No study in the last 7 days (or ever). `today` and `lastActiveDay` are YYYY-MM-DD. */
export function isInactive(lastActiveDay: string | null, today: string): boolean {
  if (!lastActiveDay) return true;
  return daysBetween(lastActiveDay, today) >= ENGAGEMENT.inactiveAfterDays;
}

/**
 * Average improvement, in points, over the topics whose path has been measured
 * again (a later score than the one before starting). Null when none has.
 */
export function averageImprovement(paths: { baseline: number | null; latest: number | null }[]): number | null {
  const measured = paths.filter((p) => p.baseline !== null && p.latest !== null);
  if (!measured.length) return null;
  const total = measured.reduce((sum, p) => sum + (p.latest! - p.baseline!), 0);
  return Math.round((total / measured.length) * 10) / 10;
}

export function effortWithoutGain(seconds: number, improvement: number | null): boolean {
  return improvement !== null && seconds / 60 >= EFFORT_WITHOUT_GAIN.minMinutes && improvement <= EFFORT_WITHOUT_GAIN.maxImprovement;
}

/** The first day of the period ending today (inclusive), YYYY-MM-DD. */
export function periodStart(today: string, period: ReportPeriod): string {
  return addDays(today, -(PERIOD_DAYS[period] - 1));
}

/** The start of the bucket a day falls in (weeks start on Monday). */
export function bucketOf(day: string, granularity: TrendGranularity): string {
  if (granularity === 'day') return day;
  if (granularity === 'month') return `${day.slice(0, 7)}-01`;
  if (granularity === 'year') return `${day.slice(0, 4)}-01-01`;
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -back);
}

/** Every bucket of the trend window, oldest first, ending with the bucket of `today`. */
export function trendBuckets(today: string, granularity: TrendGranularity, count: number = TREND_BUCKETS[granularity]): string[] {
  const n = count;
  const out: string[] = [];
  let cursor = bucketOf(today, granularity);
  for (let i = 0; i < n; i++) {
    out.unshift(cursor);
    cursor = previousBucket(cursor, granularity);
  }
  return out;
}

/** Sum per-day usage into the trend's buckets, filling buckets with no usage with zero. */
export function buildTrend(
  rows: { day: string; studentId: string; seconds: number }[],
  today: string,
  granularity: TrendGranularity,
  count: number = TREND_BUCKETS[granularity],
): { period: string; seconds: number; activeStudents: number }[] {
  const buckets = trendBuckets(today, granularity, count);
  const index = new Map(buckets.map((b, i) => [b, i]));
  const seconds = buckets.map(() => 0);
  const students = buckets.map(() => new Set<string>());
  for (const r of rows) {
    const i = index.get(bucketOf(r.day, granularity));
    if (i === undefined || r.seconds <= 0) continue;
    seconds[i] += r.seconds;
    students[i].add(r.studentId);
  }
  return buckets.map((period, i) => ({ period, seconds: seconds[i], activeStudents: students[i].size }));
}

// ── Dates (YYYY-MM-DD, calendar arithmetic in UTC so time zones cannot shift a day) ──

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function previousBucket(bucket: string, granularity: TrendGranularity): string {
  if (granularity === 'day') return addDays(bucket, -1);
  if (granularity === 'week') return addDays(bucket, -7);
  const d = new Date(`${bucket}T00:00:00Z`);
  if (granularity === 'month') d.setUTCMonth(d.getUTCMonth() - 1);
  else d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
