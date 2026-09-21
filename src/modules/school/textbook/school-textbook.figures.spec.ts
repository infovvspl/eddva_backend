/**
 * Chapter figure persistence.
 *
 * The AI service is stateless — it crops the diagrams out of a chapter PDF and
 * hands them back as base64 PNGs — so this is where they become durable: images
 * to R2, metadata to Postgres, keyed so that re-indexing a chapter overwrites
 * the previous run rather than orphaning objects in the bucket.
 *
 * The invariant these tests protect: figures are a BONUS on top of a chapter
 * that is already successfully indexed. Nothing here may fail an ingest whose
 * passages were written, and nothing here may leave a chapter showing figures
 * from a PDF it no longer has.
 */
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

describe('persistFigures', () => {
  it('1. uploads every figure under a deterministic, chapter-scoped key', async () => {
    const { svc, s3 } = makeService();
    const stored = await svc.persistFigures(INSTITUTE, MATERIAL, [
      figure(), figure({ page_no: 9, figure_index: 1 }),
    ]);
    expect(stored).toBe(2);
    expect(s3.upload).toHaveBeenCalledTimes(2);
    expect(s3.upload.mock.calls[0][0]).toBe(
      `tenants/${INSTITUTE}/textbook-figures/ch-1/p8-0.png`,
    );
    expect(s3.upload.mock.calls[1][0]).toBe(
      `tenants/${INSTITUTE}/textbook-figures/ch-1/p9-1.png`,
    );
    // The key must be stable across runs so a re-index overwrites rather than
    // accumulating a second copy of every figure in the bucket.
    expect(s3.upload.mock.calls[0][2]).toBe('image/png');
  });

  it('2. decodes the data URI to real PNG bytes', async () => {
    const { svc, s3 } = makeService();
    await svc.persistFigures(INSTITUTE, MATERIAL, [figure()]);
    const buffer = s3.upload.mock.calls[0][1] as Buffer;
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString()).toBe('hello world');
  });

  it('3. replaces the chapter\'s previous figures in the same transaction', async () => {
    const { svc, tx } = makeService();
    await svc.persistFigures(INSTITUTE, MATERIAL, [figure()]);
    const sql = tx.query.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(sql).toContain('DELETE FROM textbook_figures');
    expect(sql).toContain('INSERT INTO textbook_figures');
    const deleteAt = tx.query.mock.calls.findIndex((c: any[]) => c[0].includes('DELETE'));
    const insertAt = tx.query.mock.calls.findIndex((c: any[]) => c[0].includes('INSERT'));
    expect(deleteAt).toBeLessThan(insertAt);
  });

  it('4. a re-index that finds no figures clears the stale ones', async () => {
    // Otherwise a chapter keeps figures from a PDF it no longer has.
    const { svc, ds } = makeService();
    const stored = await svc.persistFigures(INSTITUTE, MATERIAL, []);
    expect(stored).toBe(0);
    expect(ds.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM textbook_figures'),
      ['ch-1'],
    );
  });

  it('5. skips a figure whose payload is not a PNG data URI', async () => {
    const { svc, s3 } = makeService();
    const stored = await svc.persistFigures(INSTITUTE, MATERIAL, [
      figure({ image_base64: 'https://example.com/not-a-data-uri.png' }),
      figure({ image_base64: '' }),
      figure({ page_no: 3, figure_index: 0 }),
    ]);
    expect(stored).toBe(1);
    expect(s3.upload).toHaveBeenCalledTimes(1);
  });

  it('6. one failed upload never costs the others', async () => {
    const { svc, s3 } = makeService();
    s3.upload.mockRejectedValueOnce(new Error('R2 unreachable'));
    const stored = await svc.persistFigures(INSTITUTE, MATERIAL, [
      figure(), figure({ page_no: 9, figure_index: 0 }),
    ]);
    expect(stored).toBe(1);
  });

  it('7. every upload failing is reported as zero, not as a throw', async () => {
    // Ingestion has already written the passages by this point; a storage
    // outage must not turn a successful index into an error.
    const { svc, s3 } = makeService();
    s3.upload.mockRejectedValue(new Error('R2 down'));
    await expect(svc.persistFigures(INSTITUTE, MATERIAL, [figure()])).resolves.toBe(0);
  });

  it('8. a metadata write failure is swallowed too', async () => {
    const { svc, ds } = makeService();
    ds.transaction.mockRejectedValueOnce(new Error('deadlock'));
    await expect(svc.persistFigures(INSTITUTE, MATERIAL, [figure()])).resolves.toBe(0);
  });

  it('9. persists the full row, with bbox as JSON', async () => {
    const { svc, tx } = makeService();
    await svc.persistFigures(INSTITUTE, MATERIAL, [figure()]);
    const insert = tx.query.mock.calls.find((c: any[]) => c[0].includes('INSERT INTO textbook_figures'));
    const params = insert[1];
    expect(params).toContain(INSTITUTE);
    expect(params).toContain('ch-1');
    expect(params).toContain('Fig. 10.13');
    expect(params).toContain('Fig. 10.13: Transverse Wave');
    expect(params).toContain('vector');
    expect(params).toContain(JSON.stringify([10, 20, 300, 200]));
    expect(params).toContain(`tenants/${INSTITUTE}/textbook-figures/ch-1/p8-0.png`);
  });

  it('10. a non-numeric page or index degrades to 0 rather than a bad key', async () => {
    const { svc, s3 } = makeService();
    await svc.persistFigures(INSTITUTE, MATERIAL, [
      figure({ page_no: undefined, figure_index: null }),
    ]);
    expect(s3.upload.mock.calls[0][0]).toBe(
      `tenants/${INSTITUTE}/textbook-figures/ch-1/p0-0.png`,
    );
  });

  it('11. batches a large figure set rather than binding one giant statement', async () => {
    const { svc, tx } = makeService();
    const many = Array.from({ length: 60 }, (_v, i) =>
      figure({ page_no: i + 1, figure_index: 0 }));
    const stored = await svc.persistFigures(INSTITUTE, MATERIAL, many);
    expect(stored).toBe(60);
    const inserts = tx.query.mock.calls.filter((c: any[]) => c[0].includes('INSERT INTO textbook_figures'));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    // Postgres caps bind parameters per statement; each figure binds 15.
    for (const call of inserts) expect(call[1].length).toBeLessThan(65535);
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

describe('backfillFigures', () => {
  function makeBackfillService(rows: any[], ingest?: jest.Mock) {
    const { svc, ds, s3 } = makeService();
    const aiBridge = { ingestTextbook: ingest || jest.fn(async () => ({ data: { figures: [figure()] } })) };
    (svc as any).aiBridge = aiBridge;
    svc.resolveInstitute = jest.fn(() => INSTITUTE);
    ds.query.mockResolvedValueOnce(rows);
    return { svc, ds, s3, aiBridge };
  }

  const ROW = {
    id: 'mat-1', s3_key: 'https://cdn.example/ch1.pdf', chapter_id: 'ch-1',
    class_id: 'cl-1', subject_id: 'su-1', chapter_name: 'Sound',
  };

  it('17. never re-runs OCR — a scan would re-pay for the whole transcription', async () => {
    const { svc, aiBridge } = makeBackfillService([ROW]);
    await svc.backfillFigures({ instituteId: INSTITUTE }, {});
    expect(aiBridge.ingestTextbook).toHaveBeenCalledWith(
      expect.objectContaining({ allowOcr: false, wantFigures: true }),
      INSTITUTE,
    );
  });

  it('18. skips chapters that already have figures, unless forced', async () => {
    const { svc, ds } = makeBackfillService([ROW]);
    await svc.backfillFigures({ instituteId: INSTITUTE }, {});
    expect(ds.query.mock.calls[0][0]).toContain('NOT EXISTS');

    const forced = makeBackfillService([ROW]);
    await forced.svc.backfillFigures({ instituteId: INSTITUTE }, { force: true });
    expect(forced.ds.query.mock.calls[0][0]).not.toContain('NOT EXISTS');
  });

  it('19. reports what it stored per chapter', async () => {
    const { svc } = makeBackfillService([ROW]);
    const out = await svc.backfillFigures({ instituteId: INSTITUTE }, {});
    expect(out.scanned).toBe(1);
    expect(out.figures).toBe(1);
    expect(out.chapters[0]).toMatchObject({ chapterId: 'ch-1', chapterName: 'Sound', figures: 1 });
  });

  it('20. one unreadable chapter does not stop the run', async () => {
    const ingest = jest.fn()
      .mockRejectedValueOnce(new Error('404 from CDN'))
      .mockResolvedValueOnce({ data: { figures: [figure()] } });
    const { svc } = makeBackfillService([ROW, { ...ROW, chapter_id: 'ch-2', chapter_name: 'Light' }], ingest);
    const out = await svc.backfillFigures({ instituteId: INSTITUTE }, {});
    expect(out.scanned).toBe(2);
    expect(out.chapters[0].error).toBeTruthy();
    expect(out.chapters[1].figures).toBe(1);
  });

  it('21. clamps the batch size to a sane range', async () => {
    for (const [given, expected] of [[0, 25], [5000, 200], [10, 10]] as const) {
      const { svc, ds } = makeBackfillService([]);
      await svc.backfillFigures({ instituteId: INSTITUTE }, { limit: given });
      expect(ds.query.mock.calls[0][1]).toEqual([INSTITUTE, expected]);
    }
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
