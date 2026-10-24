/**
 * Text-mode highlights on `school_material_highlights`: AI-generated notes
 * (rendered as Markdown, not PDF) are highlighted by substring match, so
 * these rows carry no page/rects, unlike the existing PDF-highlight rows.
 */
import { BadRequestException } from '@nestjs/common';
import { SchoolMaterialService } from './school-material.service';

const INSTITUTE = 'inst-1';
const STUDENT = { id: 'u-1', role: 'STUDENT', instituteId: INSTITUTE };

function makeService() {
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    // assertStudentCanAccessMaterial's roster-membership check
    if (sql.includes('FROM study_materials sm') && sql.includes('JOIN students st')) return [{ '?column?': 1 }];
    if (sql.includes('FROM study_materials m') && sql.includes('JOIN users u')) {
      return [{ id: 'm-1', topic_id: 't-1' }];
    }
    if (sql.includes('INSERT INTO school_material_highlights')) {
      return [{
        id: 'h-1', materialId: 'm-1', topicId: 't-1', createdBy: STUDENT.id,
        highlightType: sql.includes("'text'") ? 'text' : 'pdf',
        selectedText: params[3], color: params[4], category: params[5],
      }];
    }
    return [];
  });
  const svc = new SchoolMaterialService(
    { query } as any, {} as any, {} as any, { create: jest.fn() } as any, {} as any, {} as any, {} as any,
  );
  return { svc, query };
}

describe('SchoolMaterialService — text-mode highlights', () => {
  it('saves a text highlight with no pageNumber/rects', async () => {
    const { svc } = makeService();
    const res: any = await svc.saveHighlight(STUDENT, 'm-1', { selectedText: 'mitochondria is the powerhouse', color: '#fef08a' });
    expect(res.data.highlightType).toBe('text');
    expect(res.data.selectedText).toBe('mitochondria is the powerhouse');
  });

  it('defaults category to "concept" when omitted', async () => {
    const { svc } = makeService();
    const res: any = await svc.saveHighlight(STUDENT, 'm-1', { selectedText: 'some text', color: 'yellow' });
    expect(res.data.category).toBe('concept');
  });

  it('rejects a text highlight with no selectedText', async () => {
    const { svc } = makeService();
    await expect(svc.saveHighlight(STUDENT, 'm-1', { color: 'yellow' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still requires pageNumber/rects/category for a PDF-mode highlight', async () => {
    const { svc } = makeService();
    await expect(
      svc.saveHighlight(STUDENT, 'm-1', { pageNumber: 1, selectedText: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
