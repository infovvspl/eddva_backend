import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MasteryQueryService } from './mastery-query.service';

describe('MasteryQueryService.queueRecompute', () => {
  const student = { studentId: 'st1', userId: 'u1', instituteId: 'inst-A', sectionId: 'sec', classId: 'cls' };

  const build = (found: any = student) => {
    const ds = { query: jest.fn().mockResolvedValue([{ id: 'st1' }, { id: 'st2' }]) };
    const curriculum = { findStudent: jest.fn().mockResolvedValue(found) };
    const queue = { enqueueRecompute: jest.fn(async (ids: string[]) => ids.length) };
    const service = new MasteryQueryService(ds as any, curriculum as any, queue as any);
    return { service, ds, queue };
  };

  it('queues one student of the admin\'s own institute immediately', async () => {
    const { service, queue } = build();
    await expect(service.queueRecompute({ role: 'INSTITUTE_ADMIN', instituteId: 'inst-A' }, 'st1')).resolves.toEqual({ queued: 1 });
    expect(queue.enqueueRecompute).toHaveBeenCalledWith(['st1'], 0);
  });

  it('refuses a student of another institute', async () => {
    const { service, queue } = build();
    await expect(service.queueRecompute({ role: 'INSTITUTE_ADMIN', instituteId: 'inst-B' }, 'st1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(queue.enqueueRecompute).not.toHaveBeenCalled();
  });

  it('lets a super admin queue any institute\'s student', async () => {
    const { service } = build();
    await expect(service.queueRecompute({ role: 'SUPER_ADMIN', instituteId: 'inst-B' }, 'st1')).resolves.toEqual({ queued: 1 });
  });

  it('reports an unknown student', async () => {
    const { service } = build(null);
    await expect(service.queueRecompute({ role: 'INSTITUTE_ADMIN', instituteId: 'inst-A' }, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('queues the whole institute, scoped by the caller\'s institute', async () => {
    const { service, ds, queue } = build();
    await expect(service.queueRecompute({ role: 'INSTITUTE_ADMIN', instituteId: 'inst-A' })).resolves.toEqual({ queued: 2 });
    expect(ds.query).toHaveBeenCalledWith(expect.stringContaining('WHERE institute_id::text = $1::text'), ['inst-A']);
    expect(queue.enqueueRecompute).toHaveBeenCalledWith(['st1', 'st2'], 0);
  });

  it('refuses an institute-wide run for an account without an institute', async () => {
    const { service } = build();
    await expect(service.queueRecompute({ role: 'SUPER_ADMIN' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
