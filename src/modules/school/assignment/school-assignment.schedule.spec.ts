import { BadRequestException } from '@nestjs/common';
import { SchoolAssignmentService } from './school-assignment.service';

describe('SchoolAssignmentService schedule rules', () => {
  const svc = new SchoolAssignmentService({} as any, {} as any, {} as any, {} as any, {} as any) as any;
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  it('defaults to publishing now with legacy-compatible rules', () => {
    expect(svc.parseScheduleRules({})).toEqual({
      status: 'active', startAt: null, latePolicy: 'allow', maxAttempts: null,
    });
  });

  it('saves a draft without a start date', () => {
    expect(svc.parseScheduleRules({ publish_mode: 'draft', start_at: inHours(2) }).status).toBe('draft');
    expect(svc.parseScheduleRules({ publish_mode: 'draft', start_at: inHours(2) }).startAt).toBeNull();
  });

  it('scheduling needs a future start date', () => {
    expect(() => svc.parseScheduleRules({ publish_mode: 'scheduled' })).toThrow(BadRequestException);
    expect(() => svc.parseScheduleRules({ publish_mode: 'scheduled', start_at: inHours(-5) })).toThrow(BadRequestException);
    const ok = svc.parseScheduleRules({ publish_mode: 'scheduled', start_at: inHours(3) });
    expect(ok.status).toBe('scheduled');
    expect(ok.startAt).toBeInstanceOf(Date);
  });

  it('rejects a due date that is not after the start date', () => {
    expect(() =>
      svc.parseScheduleRules({ publish_mode: 'scheduled', start_at: inHours(3), due_date: inHours(2) }),
    ).toThrow(BadRequestException);
  });

  it('normalises late policy and attempt limits', () => {
    expect(svc.parseScheduleRules({ late_policy: 'block', max_attempts: '3' })).toMatchObject({
      latePolicy: 'block', maxAttempts: 3,
    });
    expect(svc.parseScheduleRules({ late_policy: 'weird', max_attempts: 0 })).toMatchObject({
      latePolicy: 'allow', maxAttempts: null,
    });
    expect(svc.parseScheduleRules({ max_attempts: 999 }).maxAttempts).toBe(20);
  });

  it('rejects an invalid start date', () => {
    expect(() => svc.parseScheduleRules({ publish_mode: 'scheduled', start_at: 'not-a-date' })).toThrow(BadRequestException);
  });
});
