import { canSeeSubject, FULL_ACCESS, grantsFromAssignments, teacherAccess } from './report-scope';

describe('grantsFromAssignments', () => {
  it('gives a class teacher every subject and a subject teacher their subject', () => {
    expect(grantsFromAssignments([
      { class_id: 'c10', section_id: 'A', subject_id: 'sci', is_class_teacher: 't' },
      { class_id: 'c9', section_id: 'B', subject_id: 'maths', is_class_teacher: false },
      { class_id: 'c8', section_id: null, subject_id: 'eng', is_class_teacher: null },
    ])).toEqual([
      { classId: 'c10', sectionId: 'A', subjectId: null },
      { classId: 'c9', sectionId: 'B', subjectId: 'maths' },
      { classId: 'c8', sectionId: null, subjectId: 'eng' },
    ]);
  });

  it('ignores assignments with no class or section, and subject assignments with no subject', () => {
    expect(grantsFromAssignments([
      { class_id: null, section_id: null, subject_id: 'sci', is_class_teacher: true },
      { class_id: 'c9', section_id: 'B', subject_id: null, is_class_teacher: false },
    ])).toEqual([]);
  });
});

describe('teacherAccess', () => {
  const grants = grantsFromAssignments([
    { class_id: 'c10', section_id: 'A', subject_id: null, is_class_teacher: true }, // class teacher of 10-A
    { class_id: 'c10', section_id: 'B', subject_id: 'sci', is_class_teacher: false }, // science in 10-B
    { class_id: 'c10', section_id: 'B', subject_id: 'phy', is_class_teacher: false }, // physics in 10-B
    { class_id: 'c9', section_id: null, subject_id: 'maths', is_class_teacher: false }, // maths to all of class 9
  ]);

  it('sees every subject of their own section', () => {
    expect(teacherAccess(grants, { classId: 'c10', sectionId: 'A' })).toEqual({ allSubjects: true, subjectIds: new Set() });
  });

  it('sees only their subjects in a section they teach', () => {
    const access = teacherAccess(grants, { classId: 'c10', sectionId: 'B' })!;
    expect(access.allSubjects).toBe(false);
    expect([...access.subjectIds].sort()).toEqual(['phy', 'sci']);
  });

  it('covers every section of a class taught class-wide', () => {
    expect(teacherAccess(grants, { classId: 'c9', sectionId: 'Z' })).toEqual({ allSubjects: false, subjectIds: new Set(['maths']) });
  });

  it('sees nothing of a student they do not teach', () => {
    expect(teacherAccess(grants, { classId: 'c10', sectionId: 'C' })).toBeNull();
    expect(teacherAccess(grants, { classId: 'c8', sectionId: null })).toBeNull();
  });
});

describe('canSeeSubject', () => {
  const sciOnly = { allSubjects: false, subjectIds: new Set(['sci']) };

  it('limits a subject teacher to their subjects, and hides subject-less activity from them', () => {
    expect(canSeeSubject(sciOnly, 'sci')).toBe(true);
    expect(canSeeSubject(sciOnly, 'maths')).toBe(false);
    expect(canSeeSubject(sciOnly, null)).toBe(false); // planner home, general chat
    expect(canSeeSubject(FULL_ACCESS, null)).toBe(true);
  });

  it('applies a subject filter only within what the viewer may see', () => {
    expect(canSeeSubject(FULL_ACCESS, 'maths', 'maths')).toBe(true);
    expect(canSeeSubject(FULL_ACCESS, 'sci', 'maths')).toBe(false);
    expect(canSeeSubject(sciOnly, 'maths', 'maths')).toBe(false); // filtering cannot widen access
  });
});
