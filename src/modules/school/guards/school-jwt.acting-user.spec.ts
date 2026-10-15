import { actingUser } from './school-jwt.guard';

describe('actingUser (teacher portal)', () => {
  const subAdminTeacher = {
    id: 'u1', role: 'TEACHER,INSTITUTE_ADMIN', isPrimaryAdmin: false, adminPermissions: ['students'],
  };

  it('makes a teacher who is also a limited admin a plain teacher in the teacher portal', () => {
    const u = actingUser(subAdminTeacher, 'teacher', '/api/v1/school/teachers/u1');
    expect(u.role).toBe('TEACHER');
    expect(u.accountRole).toBe('TEACHER,INSTITUTE_ADMIN');
    expect(u.isPrimaryAdmin).toBe(false);
    expect(u.adminPermissions).toBeNull();
  });

  it('never modifies the cached user object', () => {
    actingUser(subAdminTeacher, 'teacher', '/api/v1/school/timetable');
    expect(subAdminTeacher.role).toBe('TEACHER,INSTITUTE_ADMIN');
    expect(subAdminTeacher.adminPermissions).toEqual(['students']);
  });

  it('keeps the whole account outside the teacher portal', () => {
    expect(actingUser(subAdminTeacher, undefined, '/api/v1/school/teachers/u1')).toBe(subAdminTeacher);
    expect(actingUser(subAdminTeacher, 'admin', '/api/v1/school/teachers/u1')).toBe(subAdminTeacher);
  });

  it('keeps the whole account on auth endpoints, so the session still knows the admin role', () => {
    expect(actingUser(subAdminTeacher, 'teacher', '/api/v1/school/auth/me')).toBe(subAdminTeacher);
  });

  it('cannot be used to gain a role the account does not have', () => {
    const admin = { id: 'a1', role: 'INSTITUTE_ADMIN', isPrimaryAdmin: false, adminPermissions: ['students'] };
    expect(actingUser(admin, 'teacher', '/api/v1/school/timetable')).toBe(admin);
    const student = { id: 's1', role: 'STUDENT' };
    expect(actingUser(student, 'teacher', '/api/v1/school/timetable')).toBe(student);
  });

  it('leaves a plain teacher unchanged', () => {
    const t = { id: 't1', role: 'TEACHER' };
    expect(actingUser(t, 'teacher', '/api/v1/school/timetable')).toBe(t);
  });
});
