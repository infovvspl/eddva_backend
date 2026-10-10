/**
 * Chapter figures and book training.
 *
 * Book training (indexing a chapter PDF) no longer extracts figures: it was
 * removed on 2026-10-10. Training asks the AI service for passages only,
 * stores no images, and the bulk "backfill figures" endpoint is gone.
 *
 * Figures stored before that are still read by question papers
 * (getChapterFigures / getSubjectFigures). The one thing training still does
 * to them: figures cropped from a different file than the one just indexed
 * are dropped, so a chapter never shows figures from a PDF it no longer has.
 */
import { SchoolTextbookController } from './school-textbook.controller';
import { SchoolTextbookService } from './school-textbook.service';

const INSTITUTE = 'e9f3592d-851a-43be-9361-574e57722703';
const PNG = 'data:image/png;base64,aGVsbG8gd29ybGQ=';   // "hello world"

const MATERIAL = {
  id: 'mat-1', chapter_id: 'ch-1', class_id: 'cl-1', subject_id: 'su-1',
  chapter_name: 'Sound',
};

function makeService() {
  const queries: Array<{ sql: string; params: any[] }> = [];
  const tx = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      queries.push({ sql, params });
      return [];
    }),
  };
  const ds = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      queries.push({ sql, params });
      return [];
    }),
    transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const s3 = {
    upload: jest.fn(async (key: string, _body: Buffer, _contentType: string) =>
      `https://media.example/${key}`),
    toPublicUrl: jest.fn((key: string) => `https://media.example/${key}`),
  };
  const svc: any = new SchoolTextbookService({} as any, ds as any, s3 as any);
  svc.ensureSchema = jest.fn(async () => {});
  return { svc, ds, tx, s3, queries };
}

function figure(over: Record<string, any> = {}) {
  return {
    page_no: 8, figure_index: 0, label: 'Fig. 10.13',
    caption: 'Fig. 10.13: Transverse Wave', detector: 'vector',
    bbox: [10, 20, 300, 200], width: 900, height: 260,
    image_base64: PNG, ...over,
  };
}

describe('book training does not extract figures', () => {
  const ROW = {
    id: 'mat-1', s3_key: 'https://cdn.example/ch1.pdf', chapter_id: 'ch-1',
    class_id: 'cl-1', subject_id: 'su-1', chapter_name: 'Sound',
  };

  function makeTrainingService(reply?: any) {
    const made = makeService();
    const aiBridge = {
      // Even if an AI service still sent figures, training must ignore them.
      ingestTextbook: jest.fn(async () => reply ?? ({
        data: { chunks: [{ content: 'Sound is a wave.', page_no: 1 }], pages: 3,
                method: 'text_layer', quality: 'ok', figures: [figure()] },
      })),
    };
    (made.svc as any).aiBridge = aiBridge;
    made.svc.resolveInstitute = jest.fn(() => INSTITUTE);
    made.svc.recordSource = jest.fn(async () => {});
    made.ds.query.mockImplementation(async (sql: string, params: any[] = []) => {
      made.queries.push({ sql, params });
      return sql.trimStart().startsWith('SELECT sm.id') ? [ROW] : [];
    });
    return { ...made, aiBridge };
  }

  it('1. asks the AI service for passages only', async () => {
    const { svc, aiBridge } = makeTrainingService();
    await svc.ingestMaterial({}, 'mat-1', INSTITUTE, 'run-1');
    const [dto, tenant] = (aiBridge.ingestTextbook.mock.calls[0] as any[]);
    expect(dto).toEqual({ fileUrl: ROW.s3_key, progressKey: 'run-1' });
    expect(dto).not.toHaveProperty('wantFigures');
    expect(tenant).toBe(INSTITUTE);
  });

  it('2. stores no figure, even when the reply carries some', async () => {
    const { svc, s3, queries } = makeTrainingService();
    const out = await svc.ingestMaterial({}, 'mat-1', INSTITUTE);
    expect(s3.upload).not.toHaveBeenCalled();
    expect(queries.some((q) => q.sql.includes('INSERT INTO textbook_figures'))).toBe(false);
    expect(out).toMatchObject({ indexed: true, chunks: 1, pages: 3 });
    expect(out).not.toHaveProperty('figures');
  });

  it('3. keeps figures made from this file; drops those from a replaced book', async () => {
    const { svc, queries } = makeTrainingService();
    await svc.ingestMaterial({}, 'mat-1', INSTITUTE);
    const drops = queries.filter((q) => q.sql.includes('DELETE FROM textbook_figures'));
    expect(drops).toHaveLength(1);
    expect(drops[0].sql).toContain('material_id::text IS DISTINCT FROM');
    expect(drops[0].params).toEqual(['ch-1', 'mat-1']);
  });

  it('4. a failed clean-up never fails a chapter whose passages were written', async () => {
    const { svc, ds } = makeTrainingService();
    const answer = ds.query.getMockImplementation()!;
    ds.query.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('DELETE FROM textbook_figures')) throw new Error('relation does not exist');
      return answer(sql, params);
    });
    await expect(svc.ingestMaterial({}, 'mat-1', INSTITUTE)).resolves.toMatchObject({ indexed: true });
  });

  it('5. an unreadable scan stores nothing and touches no figures', async () => {
    const { svc, queries } = makeTrainingService({ data: { chunks: [], quality: 'no_text', figures: [figure()] } });
    const out = await svc.ingestMaterial({}, 'mat-1', INSTITUTE);
    expect(out.indexed).toBe(false);
    expect(queries.some((q) => q.sql.includes('textbook_figures'))).toBe(false);
  });

  it('6. the extraction and backfill code paths are gone', () => {
    const { svc } = makeService();
    expect(svc.persistFigures).toBeUndefined();
    expect(svc.backfillFigures).toBeUndefined();
    expect((SchoolTextbookController.prototype as any).backfillFigures).toBeUndefined();
  });

  it('7. the coverage list no longer counts figures', async () => {
    const { svc, queries } = makeService();
    svc.resolveInstitute = jest.fn(() => INSTITUTE);
    await svc.coverage({}, INSTITUTE);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => q.sql.includes('textbook_figures'))).toBe(false);
  });
});

describe('getSubjectFigures', () => {
  const ROW = {
    id: 'fig-1', page_no: 8, figure_index: 0, label: 'Fig. 2.3',
    caption: 'Graph of a polynomial', description: '', detector: 'vector',
    width: 900, height: 260, image_key: 'tenants/x/textbook-figures/ch-1/p8-0.png',
  };

  it('22. spreads the budget across chapters instead of draining the first', async () => {
    // Ordering by chapter alone would illustrate a whole annual paper from the
    // opening pages of the book.
    const { svc, ds } = makeService();
    ds.query.mockResolvedValueOnce([ROW]);
    await svc.getSubjectFigures(INSTITUTE, 'sub-1', 24);
    const sql = ds.query.mock.calls[0][0];
    expect(sql).toContain('PARTITION BY');
    expect(sql).toContain('rank_in_chapter');
  });

  it('23. is scoped by institute and subject', async () => {
    const { svc, ds } = makeService();
    ds.query.mockResolvedValueOnce([]);
    await svc.getSubjectFigures(INSTITUTE, 'sub-1', 24);
    const [sql, params] = ds.query.mock.calls[0];
    expect(sql).toContain('institute_id');
    expect(sql).toContain('subject_id');
    expect(params).toEqual([INSTITUTE, 'sub-1', 24]);
  });

  it('24. clamps the limit to a sane range', async () => {
    for (const [given, expected] of [[0, 24], [9999, 100], [10, 10]] as const) {
      const { svc, ds } = makeService();
      ds.query.mockResolvedValueOnce([]);
      await svc.getSubjectFigures(INSTITUTE, 'sub-1', given);
      expect(ds.query.mock.calls[0][1][2]).toBe(expected);
    }
  });

  it('25. returns nothing without an institute or subject', async () => {
    const { svc, ds } = makeService();
    expect(await svc.getSubjectFigures(INSTITUTE, null)).toEqual([]);
    expect(await svc.getSubjectFigures('', 'sub-1')).toEqual([]);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('26. resolves the image URL and degrades on failure', async () => {
    const { svc, ds } = makeService();
    ds.query.mockResolvedValueOnce([ROW]);
    const out = await svc.getSubjectFigures(INSTITUTE, 'sub-1');
    expect(out[0].imageUrl).toBe(`https://media.example/${ROW.image_key}`);

    const broken = makeService();
    broken.ds.query.mockRejectedValueOnce(new Error('relation does not exist'));
    await expect(broken.svc.getSubjectFigures(INSTITUTE, 'sub-1')).resolves.toEqual([]);
  });
});

describe('getChapterFigures', () => {
  const ROW = {
    id: 'fig-1', page_no: 8, figure_index: 0, label: 'Fig. 10.13',
    caption: 'Fig. 10.13: Transverse Wave', description: 'A transverse wave',
    detector: 'vector', width: 900, height: 260,
    image_key: 'tenants/x/textbook-figures/ch-1/p8-0.png',
  };

  it('12. returns figures with a resolved URL, not the stored key', async () => {
    const { svc, ds, s3 } = makeService();
    ds.query.mockResolvedValueOnce([ROW]);
    const out = await svc.getChapterFigures(INSTITUTE, 'ch-1');
    expect(out).toHaveLength(1);
    expect(out[0].imageUrl).toBe(`https://media.example/${ROW.image_key}`);
    expect(out[0].label).toBe('Fig. 10.13');
    expect(out[0].pageNo).toBe(8);
    expect(s3.toPublicUrl).toHaveBeenCalledWith(ROW.image_key);
  });

  it('13. is scoped by institute as well as chapter', async () => {
    // A chapter id alone must never reach across schools — the same rule
    // getChapterPassages follows.
    const { svc, ds } = makeService();
    ds.query.mockResolvedValueOnce([]);
    await svc.getChapterFigures(INSTITUTE, 'ch-1');
    const [sql, params] = ds.query.mock.calls[0];
    expect(sql).toContain('institute_id');
    expect(sql).toContain('chapter_id');
    expect(params).toEqual([INSTITUTE, 'ch-1']);
  });

  it('14. returns nothing when either scope key is missing', async () => {
    const { svc, ds } = makeService();
    expect(await svc.getChapterFigures(INSTITUTE, null)).toEqual([]);
    expect(await svc.getChapterFigures('', 'ch-1')).toEqual([]);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('15. a query failure degrades to no figures rather than throwing', async () => {
    const { svc, ds } = makeService();
    ds.query.mockRejectedValueOnce(new Error('relation does not exist'));
    await expect(svc.getChapterFigures(INSTITUTE, 'ch-1')).resolves.toEqual([]);
  });

  it('16. null text columns come back as empty strings, not null', async () => {
    const { svc, ds } = makeService();
    ds.query.mockResolvedValueOnce([{ ...ROW, label: null, caption: null, description: null }]);
    const out = await svc.getChapterFigures(INSTITUTE, 'ch-1');
    expect(out[0].label).toBe('');
    expect(out[0].caption).toBe('');
    expect(out[0].description).toBe('');
  });
});
