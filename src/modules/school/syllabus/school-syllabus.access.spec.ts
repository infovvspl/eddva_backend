/**
 * Access control for /school/syllabus (lesson-plan audit, 22 Oct 2026):
 * every route names its roles (D1), lesson completion is scoped to the owning
 * teacher's school (D2), global templates are super-admin only (D3), failures
 * are errors rather than fake success (D4/D6), and progress views return only
 * the caller's own data.
 */
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SCHOOL_ROLES_KEY } from '../decorators/school-roles.decorator';
import { SchoolSyllabusController } from './school-syllabus.controller';
import { SchoolSyllabusService } from './school-syllabus.service';
import { CreateLessonPlanDto, GenerateAiLessonTemplateDto } from './dto/school-syllabus.dto';

// ── Route roles ───────────────────────────────────────────────────────────────

const ROUTES = Object.getOwnPropertyNames(SchoolSyllabusController.prototype).filter((m) => m !== 'constructor');
const guard = new SchoolRolesGuard(new Reflector());
const allowed = (route: string, role: string) => {
  const handler = (SchoolSyllabusController.prototype as any)[route];
  const ctx: any = {
    getHandler: () => handler,
    getClass: () => SchoolSyllabusController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  };
  try { return guard.canActivate(ctx) === true; } catch { return false; }
};

const WRITES = ['createSyllabusPlan', 'updateSyllabusPlan', 'deleteSyllabusPlan', 'updateSyllabusPlanProgress',
  'createLessonPlan', 'generateAiLessonTemplate', 'completeLessonPlan', 'createLessonTemplate'];

describe('SchoolSyllabusController — roles on every route', () => {
  it('no route is left open to every signed-in user', () => {
    const open = ROUTES.filter((r) => !(Reflect.getMetadata(SCHOOL_ROLES_KEY, (SchoolSyllabusController.prototype as any)[r]) || []).length);
    expect(open).toEqual([]);
  });

  it.each(['STUDENT', 'PARENT'])('a %s cannot write anything, run the AI brief or read plans', (role) => {
    for (const r of [...WRITES, 'getSyllabusPlans', 'getSyllabusPlanById', 'getSyllabusTracker', 'getTeacherTeachingPlan', 'getLessonPlanById', 'getLessonTemplates']) {
      expect([r, allowed(r, role)]).toEqual([r, false]);
    }
  });

  it('a student can read their progress and a parent their child\'s, but not each other\'s', () => {
    expect(allowed('getStudentSyllabusProgress', 'STUDENT')).toBe(true);
    expect(allowed('getParentChildSyllabusProgress', 'PARENT')).toBe(true);
    expect(allowed('getParentChildSyllabusProgress', 'STUDENT')).toBe(false);
    expect(allowed('getStudentSyllabusProgress', 'PARENT')).toBe(false);
  });

  it('only admins create, change or delete syllabus plans and see the tracker', () => {
    for (const r of ['createSyllabusPlan', 'updateSyllabusPlan', 'deleteSyllabusPlan', 'getSyllabusTracker', 'getDetailedPlanTracker']) {
      expect([r, allowed(r, 'TEACHER')]).toEqual([r, false]);
      expect([r, allowed(r, 'INSTITUTE_ADMIN')]).toEqual([r, true]);
    }
  });

  it('teachers keep their lesson workflow; a teacher-admin account counts as both', () => {
    for (const r of ['getSyllabusPlans', 'getSyllabusPlanById', 'getTeacherTeachingPlan', 'createLessonPlan', 'getLessonPlanById',
      'generateAiLessonTemplate', 'completeLessonPlan', 'getLessonTemplates', 'createLessonTemplate', 'updateSyllabusPlanProgress']) {
      expect([r, allowed(r, 'TEACHER')]).toEqual([r, true]);
    }
    expect(allowed('createSyllabusPlan', 'TEACHER,INSTITUTE_ADMIN')).toBe(true);
  });
});

// ── Service scoping ───────────────────────────────────────────────────────────

const INST = 'inst-1';
const TEACHER = { id: 'u-teacher', role: 'TEACHER', instituteId: INST };
const ADMIN = { id: 'u-admin', role: 'INSTITUTE_ADMIN', instituteId: INST };
const SUPER = { id: 'u-super', role: 'SUPER_ADMIN', instituteId: INST };
const STUDENT = { id: 'u-student', role: 'STUDENT', instituteId: INST };
const PARENT = { id: 'u-parent', role: 'PARENT', instituteId: INST, email: 'mum@example.com', phone: null };

function makeService(over: { lesson?: any; assigned?: boolean; failInsert?: boolean; ai?: any; children?: any[] } = {}) {
  const calls: Array<[string, any[]]> = [];
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    calls.push([sql, params]);
    const q = sql.replace(/\s+/g, ' ');
    if (q.includes('FROM teachers WHERE user_id')) return params[0] === TEACHER.id ? [{ id: 't-1' }] : [];
    if (q.includes('FROM teacher_academic_assignments')) return over.assigned === false ? [] : [{ 1: 1 }];
    if (q.includes('SELECT * FROM lesson_plans WHERE id = $1 AND institute_id = $2 AND teacher_id = $3')) {
      const l = over.lesson;
      return l && l.institute_id === params[1] && l.teacher_id === params[2] ? [l] : [];
    }
    if (q.includes('INSERT INTO lesson_completions')) {
      if (over.failInsert) throw new Error('db down');
      return [{ id: 'c-1', lesson_plan_id: params[0] }];
    }
    if (q.includes('FROM chapters WHERE id = $1 AND subject_id = $2')) return params[0] === 'ch-ok' ? [{ 1: 1 }] : [];
    if (q.includes('INSERT INTO lesson_templates')) return [{ id: 'tpl', is_global: params[5] }];
    if (q.includes('FROM students s') && q.includes('parent_email')) return over.children ?? [];
    if (q.includes('FROM students s')) {
      return params[0] === 'u-student' || params[0] === 'stu-same-school' ? [{ id: 's', section_id: 'sec', class_id: 'c', class_name: '10', section_name: 'A' }] : [];
    }
    return [];
  });
  const ds: any = { query, transaction: async (cb: any) => cb({ query }) };
  const ai = over.ai ?? { generateTopicContent: jest.fn(async () => ({ content: '## Brief' })) };
  return { svc: new SchoolSyllabusService(ds, ai), calls, ai };
}

describe('SchoolSyllabusService — lesson completion (D2, D4)', () => {
  const lesson = { id: 'l-1', institute_id: INST, teacher_id: TEACHER.id, status: 'SCHEDULED', duration_periods: 1 };

  it('another school\'s or another teacher\'s lesson is not found', async () => {
    const otherSchool = makeService({ lesson: { ...lesson, institute_id: 'inst-2' } });
    await expect(otherSchool.svc.completeLessonPlan(TEACHER, 'l-1', {})).rejects.toBeInstanceOf(NotFoundException);
    const otherTeacher = makeService({ lesson: { ...lesson, teacher_id: 'u-someone-else' } });
    await expect(otherTeacher.svc.completeLessonPlan(TEACHER, 'l-1', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('an unknown id no longer creates a plan', async () => {
    const { svc, calls } = makeService({ lesson: undefined });
    await expect(svc.completeLessonPlan(TEACHER, 'l-x', { classId: 'c', subjectId: 's' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(calls.some(([sql]) => sql.includes('INSERT INTO lesson_plans'))).toBe(false);
  });

  it('the owner records it once; the status update is scoped to them', async () => {
    const { svc, calls } = makeService({ lesson });
    const res: any = await svc.completeLessonPlan(TEACHER, 'l-1', { completionType: 'FULLY' });
    expect(res.completion).toMatchObject({ id: 'c-1' });
    const update = calls.find(([sql]) => sql.includes("UPDATE lesson_plans SET status = 'COMPLETED'"))!;
    expect(update[0]).toContain('institute_id = $2 AND teacher_id = $3');
    expect(update[1]).toEqual(['l-1', INST, TEACHER.id]);
    const done = makeService({ lesson: { ...lesson, status: 'COMPLETED' } });
    await expect(done.svc.completeLessonPlan(TEACHER, 'l-1', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('a failed insert is an error, not a fake success', async () => {
    const { svc } = makeService({ lesson, failInsert: true });
    await expect(svc.completeLessonPlan(TEACHER, 'l-1', {})).rejects.toThrow('db down');
  });
});

describe('SchoolSyllabusService — lesson plans and the AI brief', () => {
  it('a teacher cannot plan for a class or subject they do not teach', async () => {
    const { svc } = makeService({ assigned: false });
    await expect(svc.createLessonPlan(TEACHER, { classId: 'c', sectionId: 'sec', subjectId: 's' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an admin reads any plan of their school; a teacher only their own', async () => {
    const { svc, calls } = makeService();
    await svc.getLessonPlanById(ADMIN, 'l-1').catch(() => undefined);
    await svc.getLessonPlanById(TEACHER, 'l-1').catch(() => undefined);
    const lookups = calls.filter(([sql]) => sql.includes('FROM lesson_plans l'));
    expect(lookups[0][1]).toEqual(['l-1', INST, ADMIN.id, true]);
    expect(lookups[1][1]).toEqual(['l-1', INST, TEACHER.id, false]);
  });

  it('when the AI fails the teacher gets an error, not a canned template', async () => {
    const ai = { generateTopicContent: jest.fn(async () => { throw new Error('provider down'); }) };
    const { svc } = makeService({ ai });
    await expect(svc.generateAiLessonTemplate(TEACHER, { subjectId: 's', chapterId: 'ch-ok' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('a chapter from another subject is refused, and a missing chapter is not guessed', async () => {
    const { svc, calls, ai } = makeService();
    await expect(svc.generateAiLessonTemplate(TEACHER, { subjectId: 's', chapterId: 'ch-other' })).rejects.toBeInstanceOf(BadRequestException);
    await svc.generateAiLessonTemplate(TEACHER, { subjectId: 's' });
    expect(calls.some(([sql]) => sql.includes('ORDER BY created_at ASC LIMIT 1'))).toBe(false);
    expect((ai.generateTopicContent as jest.Mock).mock.calls[0][0].chapterName).toBe('');
  });

  it('a teacher who does not teach the subject cannot run the brief on it', async () => {
    const { svc } = makeService({ assigned: false });
    await expect(svc.generateAiLessonTemplate(TEACHER, { subjectId: 's' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SchoolSyllabusService — templates (D3)', () => {
  it('only the super admin can publish a global template', async () => {
    for (const [user, expected] of [[TEACHER, false], [ADMIN, false], [SUPER, true]] as const) {
      const { svc } = makeService();
      const res: any = await svc.createLessonTemplate(user, { title: 'T', isGlobal: true });
      expect([user.role, res.data.is_global]).toEqual([user.role, expected]);
    }
  });
});

describe('SchoolSyllabusService — progress views', () => {
  it('a student sees only themselves, whatever studentId they pass, within their school', async () => {
    const { svc, calls } = makeService();
    await svc.getStudentSyllabusProgress(STUDENT, 'stu-of-another-school');
    const lookup = calls.find(([sql]) => sql.includes('FROM students s'))!;
    expect(lookup[1]).toEqual(['u-student', INST]);
  });

  it('staff can look up a student of their school; an unknown or foreign one is not found', async () => {
    const { svc } = makeService();
    await expect(svc.getStudentSyllabusProgress(TEACHER, 'stu-same-school')).resolves.toMatchObject({ success: true });
    await expect(svc.getStudentSyllabusProgress(TEACHER, 'stu-elsewhere')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a parent sees their own child (the first by default) and nobody else\'s', async () => {
    const kids = [{ id: 'kid-1', section_id: 'sec', class_id: 'c', class_name: '10', section_name: 'A' }];
    const { svc, calls } = makeService({ children: kids });
    await expect(svc.getParentChildSyllabusProgress(PARENT)).resolves.toMatchObject({ success: true, student: kids[0] });
    await expect(svc.getParentChildSyllabusProgress(PARENT, 'kid-of-someone-else')).rejects.toBeInstanceOf(NotFoundException);
    const lookup = calls.find(([sql]) => sql.includes('parent_email'))!;
    expect(lookup[1]).toEqual([INST, 'mum@example.com', null]);
  });
});

// ── Validation (same pipe options as main.ts) ────────────────────────────────
describe('lesson DTO validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const validate = (metatype: any, value: any) => pipe.transform(value, { type: 'body', metatype });
  const UUID = '11111111-1111-4111-8111-111111111111';
  // What LessonPlanFormModal.jsx sends on save (its initial state, with class/section/subject picked).
  const formPayload = {
    classId: UUID, sectionId: UUID, subjectId: UUID, chapterId: '', topicId: '',
    date: '2026-10-22', durationPeriods: 1, learningObjectives: '', previousKnowledge: '',
    teachingMethodology: 'Interactive Explanation & Demonstration', teachingActivities: '', teachingResources: 'Textbook, Whiteboard',
    digitalResources: '', classroomActivities: '', assessmentMethod: 'Q&A Check', homework: '', expectedLearningOutcomes: '',
    teacherNotes: '', timetableId: null, status: 'SCHEDULED', aiBrief: null,
  };

  it('accepts the form exactly as the lesson modal sends it', async () => {
    const out: any = await validate(CreateLessonPlanDto, formPayload);
    expect(out.chapterId).toBeUndefined();
    expect(out.classId).toBe(UUID);
  });

  it('refuses non-UUID ids, a made-up status and oversized text', async () => {
    await expect(validate(CreateLessonPlanDto, { ...formPayload, classId: 'abc' })).rejects.toBeDefined();
    await expect(validate(CreateLessonPlanDto, { ...formPayload, status: 'COMPLETED' })).rejects.toBeDefined();
    await expect(validate(CreateLessonPlanDto, { ...formPayload, homework: 'x'.repeat(20_001) })).rejects.toBeDefined();
  });

  it('accepts the AI-brief request with empty optional ids', async () => {
    await expect(validate(GenerateAiLessonTemplateDto, { subjectId: UUID, chapterId: '', topicId: '', subjectName: 'Maths', chapterName: '', className: 'Class 10', topicName: '' }))
      .resolves.toMatchObject({ subjectId: UUID });
  });
});
