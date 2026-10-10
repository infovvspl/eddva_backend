/**
 * Teacher-typed flashcards: POST /school/materials stores them as Q/A Markdown
 * in `description`, tags the row's content_source, and PUT /:id lets a teacher
 * edit them — scoped to the caller's own institute.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { SchoolMaterialService } from './school-material.service';

const INSTITUTE = 'inst-1';
const ADMIN = { id: 'u-1', role: 'INSTITUTE_ADMIN', instituteId: INSTITUTE };
const DECK = '**Q:** What is a tide?\n**A:** Ocean water rising and falling.';

function makeService(opts: { existing?: any[] } = {}) {
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('INSERT INTO study_materials')) {
      return [{ id: 'm-1', type: params[1], title: params[2], description: params[5], s3_key: params[6], content_source: params[14] }];
    }
    if (sql.includes('FROM study_materials') && sql.includes('WHERE id = $1')) return opts.existing ?? [];
    return [];
  });
  const svc = new SchoolMaterialService(
    { query } as any, {} as any, {} as any, { create: jest.fn() } as any, {} as any, {} as any, {} as any,
  );
  return { svc, query };
}

const flashcardBody = (description?: string, fileUrl = '') =>
  ({ title: 'Flashcards — Water', fileType: 'flashcard', fileUrl, description });

describe('SchoolMaterialService — teacher-typed flashcards', () => {
  it('saves typed flashcards as manual content', async () => {
    const { svc } = makeService();
    const res: any = await svc.create(ADMIN, flashcardBody(DECK));
    expect(res.data).toMatchObject({ fileType: 'flashcard', description: DECK, contentSource: 'manual' });
  });

  it('tags file/link materials as uploads, without requiring card text', async () => {
    const { svc } = makeService();
    const res: any = await svc.create(ADMIN, flashcardBody(undefined, 'https://cdn.example/cards.pdf'));
    expect(res.data.contentSource).toBe('upload');
  });

  it.each([
    ['empty', ''],
    ['not Q/A', 'just some notes'],
    ['too large', `**Q:** x\n**A:** ${'y'.repeat(200_001)}`],
  ])('rejects %s typed flashcards before writing', async (_label, description) => {
    const { svc, query } = makeService();
    await expect(svc.create(ADMIN, flashcardBody(description))).rejects.toBeInstanceOf(BadRequestException);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
  });

  it('refuses to update a material outside the caller\'s institute', async () => {
    const { svc, query } = makeService({ existing: [] });
    await expect(svc.update(ADMIN, 'm-other', { description: DECK })).rejects.toBeInstanceOf(NotFoundException);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['m-other', false, INSTITUTE]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE study_materials'))).toBe(false);
  });

  it('validates edited flashcard text and saves valid edits', async () => {
    const existing = [{ subject: 'EVS', subject_id_fk: 'sub-1', type: 'flashcard', s3_key: '' }];
    const bad = makeService({ existing });
    await expect(bad.svc.update(ADMIN, 'm-1', { description: 'no cards' })).rejects.toBeInstanceOf(BadRequestException);

    const good = makeService({ existing });
    await expect(good.svc.update(ADMIN, 'm-1', { title: 'New', description: DECK })).resolves.toEqual({ success: true });
    expect(good.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE study_materials'))).toBe(true);
  });
});
