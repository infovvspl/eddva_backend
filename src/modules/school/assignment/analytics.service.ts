export type UnitStatus = 'pending' | 'submitted' | 'graded';

/** One thing that has to submit: a student (individual) or a group. */
export interface AnalyticsUnit {
  id: string;
  name: string;
  members?: string[];
  status: UnitStatus;
  marks: number | null;
  isLate: boolean;
  submittedAt: Date | string | null;
}

export interface AssignmentAnalytics {
  unitLabel: 'students' | 'groups';
  summary: {
    total: number;
    submitted: number;
    pending: number;
    evaluated: number;
    awaitingEvaluation: number;
    late: number;
    submissionRate: number | null;
    avgMarks: number | null;
    avgPercent: number | null;
    highest: number | null;
    lowest: number | null;
  };
  distribution: { label: string; count: number }[];
  units: (AnalyticsUnit & { percent: number | null })[];
}

const BUCKETS = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pure calculation of the assignment tracking numbers. */
export function buildAnalytics(
  units: AnalyticsUnit[],
  opts: { isGroup: boolean; maxMarks: number },
): AssignmentAnalytics {
  const max = opts.maxMarks > 0 ? opts.maxMarks : 100;
  const withPercent = units.map((u) => ({
    ...u,
    percent: u.marks == null ? null : round1((u.marks / max) * 100),
  }));

  const submitted = units.filter((u) => u.status !== 'pending').length;
  const evaluated = units.filter((u) => u.status === 'graded').length;
  const scored = units.filter((u) => u.status === 'graded' && u.marks != null).map((u) => u.marks as number);
  const avgMarks = scored.length ? round1(scored.reduce((a, b) => a + b, 0) / scored.length) : null;

  const distribution = BUCKETS.map((label) => ({ label, count: 0 }));
  for (const u of withPercent) {
    if (u.status !== 'graded' || u.percent == null) continue;
    const idx = Math.min(Math.max(Math.floor(u.percent / 20), 0), 4); // 100% falls in the top bucket
    distribution[idx].count++;
  }

  return {
    unitLabel: opts.isGroup ? 'groups' : 'students',
    summary: {
      total: units.length,
      submitted,
      pending: units.length - submitted,
      evaluated,
      awaitingEvaluation: submitted - evaluated,
      late: units.filter((u) => u.status !== 'pending' && u.isLate).length,
      submissionRate: units.length ? Math.round((submitted / units.length) * 100) : null,
      avgMarks,
      avgPercent: avgMarks == null ? null : round1((avgMarks / max) * 100),
      highest: scored.length ? Math.max(...scored) : null,
      lowest: scored.length ? Math.min(...scored) : null,
    },
    distribution,
    units: withPercent,
  };
}
