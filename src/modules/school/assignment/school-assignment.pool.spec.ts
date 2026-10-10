import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SchoolAssignmentService } from './school-assignment.service';

/**
 * resolvePool is the gate that decides which students an assignment can reach,
 * so these tests focus on the permission and subset rules (DB is mocked).
 */
describe('SchoolAssignmentService student pool', () => {
  const accessible = [
    { section_id: 'sec-a', section_name: 'A', class_id: 'c-9', class_name: 'Class 9' },
    { section_id: 'sec-b', section_name: 'B', class_id: 'c-9', class_name: 'Class 9' },
  ];
  const students = [
    { id: 's1', name: 'One', roll_no: '1', section_id: 'sec-a', section_name: 'A', class_name: 'Class 9', score: null },
    { id: 's2', name: 'Two', roll_no: '2', section_id: 'sec-b', section_name: 'B', class_name: 'Class 9', score: 80 },
  ];

  const makeService = () => {
    const query = jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM teachers t')) return accessible;
      if (sql.includes('FROM students s')) {
        const wanted: string[] = params[1];
        return students.filter((s) => wanted.includes(s.section_id));
      }
      return [];
    });
    const svc = new SchoolAssignmentService(
      { query } as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc: svc as any, query };
  };

  const teacher = { id: 'u1', role: 'TEACHER' };

  it('merges students from several permitted sections', async () => {
    const { svc } = makeService();
    const pool = await svc.resolvePool(teacher, 'inst', {
      sections: [{ classId: 'c-9', sectionId: 'sec-a' }, { classId: 'c-9', sectionId: 'sec-b' }],
    });
    expect(pool.map((s: any) => s.id)).toEqual(['s1', 's2']);
  });

  it('rejects a section the teacher does not teach', async () => {
    const { svc } = makeService();
    await expect(
      svc.resolvePool(teacher, 'inst', { sections: [{ classId: 'c-9', sectionId: 'sec-z' }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.resolvePool(teacher, 'inst', { sections: [{ classId: 'c-10', sectionId: 'sec-a' }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a selected-students subset cannot add students from outside the sections', async () => {
    const { svc } = makeService();
    const pool = await svc.resolvePool(teacher, 'inst', {
      sections: [{ classId: 'c-9', sectionId: 'sec-a' }],
      studentIds: ['s1', 's2', 'someone-else'],
    });
    expect(pool.map((s: any) => s.id)).toEqual(['s1']);
  });

  it('accepts the pool as a JSON string (multipart form field)', async () => {
    const { svc } = makeService();
    const pool = await svc.resolvePool(
      teacher,
      'inst',
      JSON.stringify({ sections: [{ classId: 'c-9', sectionId: 'sec-b' }] }),
    );
    expect(pool.map((s: any) => s.id)).toEqual(['s2']);
  });

  it('falls back to the primary class/section when no pool is sent', async () => {
    const { svc } = makeService();
    const pool = await svc.resolvePool(teacher, 'inst', undefined, { classId: 'c-9', sectionId: 'sec-a' });
    expect(pool.map((s: any) => s.id)).toEqual(['s1']);
  });

  it('errors on an empty pool or malformed JSON', async () => {
    const { svc } = makeService();
    await expect(
      svc.resolvePool(teacher, 'inst', { sections: [{ classId: 'c-9', sectionId: 'sec-a' }], studentIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.resolvePool(teacher, 'inst', '{oops')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.resolvePool(teacher, 'inst', undefined)).rejects.toBeInstanceOf(BadRequestException);
  });
});
