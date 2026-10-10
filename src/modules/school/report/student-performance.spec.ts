import { bandFor, summarizeAssignments, summarizeAttendance } from './student-performance';

const NOW = new Date('2026-10-10T10:00:00Z');
const past = '2026-10-01T00:00:00Z';
const future = '2026-10-20T00:00:00Z';

describe('summarizeAssignments', () => {
  const rows = [
    { id: 'a', title: 'Graded on time', due_date: past, max_marks: 10, sub_status: 'graded', sub_marks: 8, sub_late: false },
    { id: 'b', title: 'Graded late', due_date: past, max_marks: 20, sub_status: 'graded', sub_marks: 10, sub_late: true },
    { id: 'c', title: 'Waiting for teacher', due_date: past, sub_status: 'submitted', sub_late: false },
    { id: 'd', title: 'Missed', due_date: past },
    { id: 'e', title: 'Not due yet', due_date: future },
    { id: 'f', title: 'Group project', due_date: future, target_type: 'group' },
  ];

  it('splits work into graded, awaiting grading, overdue and pending', () => {
    const s = summarizeAssignments(rows, NOW);
    expect(s).toMatchObject({ total: 6, submitted: 3, graded: 2, awaitingGrading: 1, overdue: 1, pending: 2, late: 1 });
    expect(s.submissionRate).toBe(50);
  });

  it('averages graded work as a percentage of each assignment\'s own maximum', () => {
    // 8/10 = 80%, 10/20 = 50% -> 65%
    expect(summarizeAssignments(rows, NOW).avgPercent).toBe(65);
  });

  it('flags group work and keeps the newest-first order for the recent list', () => {
    const s = summarizeAssignments(rows, NOW);
    expect(s.recent[0].id).toBe('a');
    expect(s.recent.find((i) => i.id === 'f')!.isGroup).toBe(true);
    expect(s.recent.find((i) => i.id === 'a')).toMatchObject({ state: 'graded', percent: 80 });
  });

  it('copes with a student with no assignments', () => {
    expect(summarizeAssignments([], NOW)).toMatchObject({ total: 0, submissionRate: null, avgPercent: null, recent: [] });
  });

  it('defaults a missing maximum to 100 and never counts an unsubmitted late flag', () => {
    const s = summarizeAssignments([{ id: 'x', title: 't', due_date: future, sub_status: 'graded', sub_marks: 40, sub_late: true }], NOW);
    expect(s.avgPercent).toBe(40);
    expect(summarizeAssignments([{ id: 'y', title: 't', due_date: past, sub_late: true }], NOW).late).toBe(0);
  });
});

describe('summarizeAttendance', () => {
  const day = (offset: number) => new Date(NOW.getTime() - offset * 86_400_000).toISOString();
  const rows = [
    { status: 'PRESENT', date: day(1) },
    { status: 'late', date: day(2) },
    { status: 'ABSENT', date: day(3) },
    { status: 'LEAVE', date: day(40) },
    { status: 'PRESENT', date: day(50) },
  ];

  it('counts late as present and reports overall and last-30-days separately', () => {
    const a = summarizeAttendance(rows, NOW);
    expect(a.overall).toEqual({ total: 5, present: 3, absent: 1, leave: 1, percent: 60 });
    expect(a.last30Days).toEqual({ total: 3, present: 2, absent: 1, leave: 0, percent: 67 });
  });

  it('returns null percentages rather than a made-up number when there is no record', () => {
    expect(summarizeAttendance([], NOW).overall).toMatchObject({ total: 0, percent: null });
  });
});

describe('bandFor', () => {
  it('bands at 75 and 60', () => {
    expect([bandFor(90), bandFor(75), bandFor(74), bandFor(60), bandFor(59)]).toEqual(
      ['strong', 'strong', 'steady', 'steady', 'needs_focus'],
    );
  });
});
