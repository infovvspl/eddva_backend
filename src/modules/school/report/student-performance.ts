/** Pure summaries used by the teacher's "student performance" cards. No DB or Nest dependencies. */

const round = (n: number) => Math.round(n);

export interface AssignmentRow {
  id: string;
  title: string;
  subject_name?: string | null;
  due_date?: Date | string | null;
  max_marks?: number | string | null;
  target_type?: string | null;
  sub_status?: string | null;
  sub_marks?: number | string | null;
  sub_late?: boolean | null;
  submitted_at?: Date | string | null;
}

export type AssignmentState = 'graded' | 'submitted' | 'overdue' | 'pending';

export function summarizeAssignments(rows: AssignmentRow[], now: Date = new Date()) {
  const items = rows.map((r) => {
    const submitted = !!r.sub_status;
    const graded = r.sub_status === 'graded' || (submitted && r.sub_marks != null);
    const due = r.due_date ? new Date(r.due_date) : null;
    const max = Number(r.max_marks) > 0 ? Number(r.max_marks) : 100;
    const state: AssignmentState = graded
      ? 'graded'
      : submitted
        ? 'submitted'
        : due && due.getTime() < now.getTime()
          ? 'overdue'
          : 'pending';
    return {
      id: r.id,
      title: r.title,
      subject: r.subject_name || null,
      dueDate: r.due_date ?? null,
      isGroup: r.target_type === 'group',
      state,
      isLate: submitted && r.sub_late === true,
      marks: graded && r.sub_marks != null ? Number(r.sub_marks) : null,
      maxMarks: max,
      percent: graded && r.sub_marks != null ? round((Number(r.sub_marks) / max) * 100) : null,
    };
  });

  const count = (s: AssignmentState) => items.filter((i) => i.state === s).length;
  const submittedCount = count('graded') + count('submitted');
  const scored = items.filter((i) => i.percent != null) as { percent: number }[];
  return {
    total: items.length,
    submitted: submittedCount,
    graded: count('graded'),
    awaitingGrading: count('submitted'),
    pending: count('pending'),
    overdue: count('overdue'),
    late: items.filter((i) => i.isLate).length,
    // of the work that has come due or been handed in, how much was handed in
    submissionRate: items.length ? round((submittedCount / items.length) * 100) : null,
    avgPercent: scored.length ? round(scored.reduce((n, i) => n + i.percent, 0) / scored.length) : null,
    recent: items.slice(0, 6),
  };
}

export function summarizeAttendance(rows: { status?: string | null; date?: Date | string | null }[], now: Date = new Date()) {
  const norm = (r: { status?: string | null }) => String(r.status || '').toUpperCase();
  const tally = (list: typeof rows) => {
    const present = list.filter((r) => ['PRESENT', 'LATE'].includes(norm(r))).length;
    const absent = list.filter((r) => norm(r) === 'ABSENT').length;
    const leave = list.filter((r) => norm(r) === 'LEAVE').length;
    return { total: list.length, present, absent, leave, percent: list.length ? round((present / list.length) * 100) : null };
  };
  const cutoff = now.getTime() - 30 * 86_400_000;
  const recent = rows.filter((r) => r.date && new Date(r.date).getTime() >= cutoff);
  return { overall: tally(rows), last30Days: tally(recent) };
}

export type Band = 'strong' | 'steady' | 'needs_focus';
/** Colour band for a percentage: 75+ strong, 60-74 steady, below 60 needs focus. */
export const bandFor = (percent: number): Band => (percent >= 75 ? 'strong' : percent >= 60 ? 'steady' : 'needs_focus');
