// The service's other collaborators (PDF generation pulls in puppeteer, which jest cannot
// load) are irrelevant to getDashboard, so they are stubbed out.
jest.mock('../../document-generator/document-generator.service', () => ({ DocumentGeneratorService: class {} }));

import { SchoolStudentService } from './school-student.service';

type Route = [RegExp, () => any[] | Promise<any[]>];

/**
 * A DataSource that answers by SQL text and counts how many queries are in flight at once,
 * so a test can tell "one after another" from "together".
 */
function fakeDataSource(routes: Route[]) {
  let inFlight = 0;
  let peak = 0;
  const seen: string[] = [];
  const ds: any = {
    query: jest.fn(async (sql: string) => {
      seen.push(sql);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        const route = routes.find(([pattern]) => pattern.test(sql));
        if (!route) return [];
        return await route[1]();
      } finally {
        inFlight -= 1;
      }
    }),
  };
  return { ds, peak: () => peak, seen };
}

const STUDENT_ROW = {
  id: 's1', user_id: 'u1', class_id: 'c1', section_id: 'sec1', enrollment_no: 'E1',
  class_name: 'Class 8', section_name: 'A',
};

const healthyRoutes: Route[] = [
  [/FROM students s\s+JOIN users u/, () => [STUDENT_ROW]],
  [/FROM attendance_records ar/, () => [{ present: 8, absent: 1, leave: 1, total: 10 }]],
  [/FROM timetables t/, () => [{ id: 't1', subject_name: 'Maths', teacher_name: 'Ms Rao', start_time: '09:00:00', end_time: '09:45:00', room: '12', type: 'class' }]],
  [/FROM gamification_profiles/, () => [{ xp: 250, coins: 40, level: 1, badges: ['starter'], current_streak: 3, longest_streak: 5 }]],
  [/FROM users WHERE id::text/, () => [{ xp_total: 100, current_streak: 1, longest_streak: 2 }]],
  [/FROM students WHERE user_id::text/, () => [{ xp_total: 120, eddva_coins: 10, current_streak: 2, longest_streak: 3 }]],
  [/FROM school_game_scores/, () => [{ total_xp: 300, total_coins: 60 }]],
];

function service(ds: any) {
  return new SchoolStudentService(ds, {} as any, {} as any, {} as any);
}

describe('SchoolStudentService.getDashboard', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('builds the same response from the combined lookups', async () => {
    const { ds } = fakeDataSource(healthyRoutes);
    const res = await service(ds).getDashboard({ id: 'u1' });
    expect(res.success).toBe(true);
    expect(res.data.student).toMatchObject({ id: 's1', userId: 'u1', className: 'Class 8', sectionName: 'A', enrollmentNo: 'E1' });
    expect(res.data.attendanceSummary).toEqual({ present: 8, absent: 1, leave: 1, total: 10, percentage: 90 });
    expect(res.data.attendancePercentage).toBe(90);
    expect(res.data.todayClasses).toBe(1);
    expect(res.data.todayPlan[0]).toMatchObject({ subjectName: 'Maths', startTime: '09:00', endTime: '09:45' });
    // the highest of the sources wins: profile 250, game 300, user 100, student 120
    expect(res.data.xpTotal).toBe(300);
    expect(res.data.coins).toBe(60);
    expect(res.data.currentStreak).toBe(3);
    expect(res.data.longestStreak).toBe(5);
    expect(res.data.student.currentLevel).toBe(4);
    expect(res.data.student.unlockedBadges).toEqual(['starter']);
  });

  it('asks for attendance, timetable and points together, not one after another', async () => {
    const { ds, peak } = fakeDataSource(healthyRoutes);
    await service(ds).getDashboard({ id: 'u1' });
    // attendance (1) + timetable (1) + the four points lookups (4) are all in flight at once
    expect(peak()).toBeGreaterThanOrEqual(6);
  });

  it('falls back to the legacy attendance table when there are no attendance records', async () => {
    const routes: Route[] = [
      [/FROM attendance_records ar/, () => [{ present: 0, absent: 0, leave: 0, total: 0 }]],
      [/FROM attendances\s+WHERE user_id/, () => [{ present: 3, absent: 1, leave: 0, total: 4 }]],
      ...healthyRoutes,
    ];
    const { ds } = fakeDataSource(routes);
    const res = await service(ds).getDashboard({ id: 'u1' });
    expect(res.data.attendanceSummary).toEqual({ present: 3, absent: 1, leave: 0, total: 4, percentage: 75 });
  });

  it('still answers, with empty sections, when one group fails', async () => {
    const routes: Route[] = [
      [/FROM attendance_records ar/, () => { throw new Error('boom'); }],
      [/FROM timetables t/, () => { throw new Error('boom'); }],
      ...healthyRoutes,
    ];
    const { ds } = fakeDataSource(routes);
    const res = await service(ds).getDashboard({ id: 'u1' });
    expect(res.data.attendanceSummary).toEqual({ present: 0, absent: 0, leave: 0, total: 0, percentage: null });
    expect(res.data.todayPlan).toEqual([]);
    expect(res.data.xpTotal).toBe(300);
  });

  it('returns zeros when the student has no user id at all', async () => {
    const { ds } = fakeDataSource([]);
    const res = await service(ds).getDashboard({});
    expect(res.success).toBe(true);
    expect(res.data.xpTotal).toBe(0);
    expect(res.data.todayPlan).toEqual([]);
  });
});
