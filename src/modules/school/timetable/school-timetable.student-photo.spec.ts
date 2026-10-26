/** The student timetable carries each teacher's profile photo (shown beside the name). */
import { SchoolTimetableService } from './school-timetable.service';

function makeService() {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM students WHERE user_id')) return [{ id: 's1', section_id: 'sec1', institute_id: 'inst1' }];
    if (sql.includes('SELECT class_id FROM sections')) return [{ class_id: 'c1' }];
    if (sql.includes('FROM timetables t')) {
      return [
        { day_of_week: 1, start_time: '09:00:00', end_time: '09:45:00', type: 'offline', subject: 'Maths', teacher: 'Anita Mishra', teacherImage: 'https://media.eddva.in/t/anita.jpg' },
        { day_of_week: 1, start_time: '10:00:00', end_time: '10:45:00', type: 'offline', subject: 'Science', teacher: 'Ajay Rout', teacherImage: null },
      ];
    }
    if (sql.includes('FROM schedules s')) {
      return [{ day_of_week: 'tuesday', start_time: '11:00:00', end_time: '11:45:00', subject: 'English', teacher: 'Neha Sharma', teacherImage: 'https://media.eddva.in/t/neha.jpg' }];
    }
    return [];
  });
  return { svc: new SchoolTimetableService({ query } as any, {} as any), query };
}

describe('SchoolTimetableService.getStudentTimetable — teacher photos', () => {
  it('selects the teacher photo in both timetable sources', async () => {
    const { svc, query } = makeService();
    await svc.getStudentTimetable({ id: 'u1' });
    const sqls = query.mock.calls.map(([sql]) => String(sql));
    expect(sqls.filter((s) => s.includes('u.profile_image AS "teacherImage"'))).toHaveLength(2);
  });

  it('returns the photo per slot, or null when the teacher has none', async () => {
    const { svc } = makeService();
    const { timetable } = (await svc.getStudentTimetable({ id: 'u1' })) as any;
    const by = Object.fromEntries(timetable.map((t: any) => [t.subject, t.teacherImage]));
    expect(by).toMatchObject({ Maths: 'https://media.eddva.in/t/anita.jpg', Science: null, English: 'https://media.eddva.in/t/neha.jpg' });
  });
});
