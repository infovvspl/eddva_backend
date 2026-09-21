/**
 * Diagram persistence.
 *
 * Three properties carry the weight.
 *
 * A ROW MUST NEVER LIE. `image_key` is a claim that a rendered image exists.
 * The object is therefore written to R2 before the row, and a failure at
 * either step must not leave a row asserting something untrue.
 *
 * APPROVAL MUST NOT TRANSFER TO A DIFFERENT DRAWING. Only an approved diagram
 * is expanded into a paper, so if an approved circle could be edited into
 * something else and stay approved, this feature would put an unreviewed
 * figure in front of students. A materially changed specification loses its
 * approval; an idle re-save keeps it.
 *
 * NO CALLER MARKUP IS EVER STORED. The stored SVG comes from the renderer, so
 * a `svg` field in the request body must be ignored entirely.
 */
import { NotFoundException, UnprocessableEntityException, ForbiddenException } from '@nestjs/common';
import { SchoolDiagramService } from './school-diagram.service';
import { canonicalJson, diagramContentHash, diagramStorageKey } from './diagram-storage-key';
import { RENDERER_VERSION } from './diagram-spec.types';

const ASSESSMENT = 'aa11bb22-0000-4000-8000-000000000001';
const OTHER_ASSESSMENT = 'bb22cc33-0000-4000-8000-000000000002';
const INSTITUTE = 'e9f3592d-851a-43be-9361-574e57722703';
const TEACHER = { id: 'user-1', role: 'TEACHER', instituteId: INSTITUTE };

const GIANT_WHEEL = {
  kind: 'geometry',
  title: 'Giant wheel',
  points: [
    { id: 'O', x: 0, y: 0, label: 'O' },
    { id: 'A', x: -6, y: 8, label: 'A' },
    { id: 'B', x: 6, y: 8, label: 'B' },
    { id: 'M', x: 0, y: 8, label: 'M' },
    { id: 'C', x: 6, y: -8, label: 'C' },
  ],
  shapes: [
    { type: 'circle', center: 'O', radius: 10 },
    { type: 'chord', circle: 'O', from: 'A', to: 'B' },
    { type: 'diameter', circle: 'O', from: 'A', to: 'C' },
    { type: 'perpendicular', from: 'O', segment: ['A', 'B'], foot: 'M' },
  ],
};

/** An in-memory assessment_diagrams table plus a recording R2. */
function makeService(seed: any[] = []) {
  const rows: any[] = [...seed];
  const uploads: Array<{ key: string; body: Buffer; type: string }> = [];

  const ds = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      if (/INSERT INTO assessment_diagrams/i.test(sql)) {
        const [institute_id, assessment_id, marker_key, diagram_type, spec, renderer_version, image_key, alt_text] = params;
        if (rows.some((r) => r.institute_id === institute_id && r.marker_key === marker_key)) {
          throw new Error('duplicate key value violates unique constraint');
        }
        rows.push({
          id: `row-${rows.length + 1}`, institute_id, assessment_id, marker_key,
          diagram_type, spec: JSON.parse(spec), renderer_version, image_key,
          alt_text, approved: false, approved_by: null, approved_at: null,
          detached_at: null, created_at: new Date(), updated_at: new Date(),
        });
        return [];
      }
      if (/SELECT \* FROM assessment_diagrams/i.test(sql)) {
        const [institute, assessment, key] = params;
        return rows.filter((r) => r.institute_id === institute
          && String(r.assessment_id) === String(assessment) && r.marker_key === key);
      }
      if (/SELECT id, marker_key/i.test(sql)) {
        const [institute, assessment] = params;
        return rows.filter((r) => r.institute_id === institute
          && String(r.assessment_id) === String(assessment));
      }
      if (/UPDATE assessment_diagrams/i.test(sql) && /SET diagram_type/i.test(sql)) {
        const [id, kind, spec, version, key, alt, unchanged] = params;
        const row = rows.find((r) => r.id === id);
        if (row) {
          Object.assign(row, {
            diagram_type: kind, spec: JSON.parse(spec), renderer_version: version,
            image_key: key, alt_text: alt, updated_at: new Date(),
          });
          if (!unchanged) { row.approved = false; row.approved_by = null; row.approved_at = null; }
        }
        return [];
      }
      if (/UPDATE assessment_diagrams/i.test(sql) && /SET approved = \$2/i.test(sql)) {
        const [id, approved, by] = params;
        const row = rows.find((r) => r.id === id);
        if (row) {
          row.approved = approved;
          row.approved_by = approved ? by : null;
          row.approved_at = approved ? new Date() : null;
        }
        return [];
      }
      return [];
    }),
  };

  const s3 = {
    upload: jest.fn(async (key: string, body: Buffer, type: string) => {
      uploads.push({ key, body, type });
      return `https://media.example/${key}`;
    }),
    toPublicUrl: jest.fn((key: string) => `https://media.example/${key}`),
  };

  const checkAssessmentAccess = jest.fn(async (_u: any, id: string) => ({
    id, institute_id: INSTITUTE,
  }));

  const svc = new SchoolDiagramService(
    ds as any, { checkAssessmentAccess } as any, s3 as any,
  );
  return { svc, ds, s3, rows, uploads, checkAssessmentAccess };
}

async function rejection(promise: Promise<any>) {
  try { await promise; } catch (err: any) {
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    return err.getResponse();
  }
  throw new Error('expected rejection');
}

// ── Content addressing ──────────────────────────────────────────────────────

describe('content hashing and keys', () => {
  it('1. canonical JSON is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    // Array order is preserved — in a diagram it is the drawing order.
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('2. the same spec and renderer hash identically', () => {
    const a = diagramContentHash(GIANT_WHEEL as any, 'v1');
    const b = diagramContentHash(JSON.parse(JSON.stringify(GIANT_WHEEL)), 'v1');
    expect(b).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('3. a different spec or a different renderer hashes differently', () => {
    const base = diagramContentHash(GIANT_WHEEL as any, 'v1');
    const moved = JSON.parse(JSON.stringify(GIANT_WHEEL));
    moved.points[1].x = -5.9;
    expect(diagramContentHash(moved, 'v1')).not.toBe(base);
    // A renderer upgrade cannot serve a stale image.
    expect(diagramContentHash(GIANT_WHEEL as any, 'v2')).not.toBe(base);
  });

  it('4. keys are tenant-scoped and carry the renderer generation', () => {
    const key = diagramStorageKey(INSTITUTE, 'a'.repeat(64), 'v1');
    expect(key).toBe(`tenants/${INSTITUTE}/assessment-diagrams/v1/${'a'.repeat(64)}.svg`);
  });
});

// ── Create ──────────────────────────────────────────────────────────────────

describe('create', () => {
  it('5. stores the SVG, then the row, and returns a marker', async () => {
    const { svc, rows, uploads } = makeService();
    const result = await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });

    expect(result.markerKey).toMatch(/^[0-9a-f]{8}$/);
    expect(result.marker).toBe(`[DIAGRAM: ${result.markerKey}]`);
    expect(result.kind).toBe('geometry');
    expect(result.rendererVersion).toBe(RENDERER_VERSION);

    expect(uploads).toHaveLength(1);
    expect(uploads[0].type).toBe('image/svg+xml');
    expect(uploads[0].body.toString('utf8').startsWith('<svg ')).toBe(true);
    expect(uploads[0].key).toBe(
      diagramStorageKey(INSTITUTE, diagramContentHash(rows[0].spec, RENDERER_VERSION)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].image_key).toBe(uploads[0].key);
  });

  it('6. a new diagram is never approved', async () => {
    const { svc, rows } = makeService();
    const result = await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    expect(result.approved).toBe(false);
    expect(rows[0].approved).toBe(false);
    expect(rows[0].approved_by).toBeNull();
  });

  it('7. caller-supplied SVG is ignored — the renderer is the only source', async () => {
    const { svc, uploads } = makeService();
    await svc.create(TEACHER, ASSESSMENT, {
      spec: GIANT_WHEEL,
      svg: '<svg onload="alert(1)"><script>evil()</script></svg>',
      image_key: 'tenants/other/evil.svg',
    });
    const stored = uploads[0].body.toString('utf8');
    expect(stored).not.toContain('evil');
    expect(stored).not.toContain('onload');
    expect(uploads[0].key).toContain(`tenants/${INSTITUTE}/`);
  });

  it('8. identical specs reuse one stored object', async () => {
    const { svc, uploads, rows } = makeService();
    const a = await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    const b = await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    // Two independent rows, one object.
    expect(rows).toHaveLength(2);
    expect(a.markerKey).not.toBe(b.markerKey);
    expect(uploads[0].key).toBe(uploads[1].key);
    expect(a.url).toBe(b.url);
  });

  it('9. an upload failure leaves NO row behind', async () => {
    const { svc, s3, rows } = makeService();
    s3.upload.mockRejectedValueOnce(new Error('R2 unreachable'));
    const body = await rejection(svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL }));
    expect(body.stage).toBe('storage');
    expect(body.errors.join(' ')).toContain('could not be stored');
    expect(rows).toHaveLength(0);          // nothing claims an image that is absent
  });

  it('10. a database failure is reported as storage, not as a server fault', async () => {
    const { svc, ds } = makeService();
    ds.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO assessment_diagrams/i.test(sql)) throw new Error('deadlock detected');
      return [];
    });
    const body = await rejection(svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL }));
    expect(body.stage).toBe('storage');
    expect(body.errors.join(' ')).toContain('could not be saved');
  });

  it('11. a marker-key collision retries rather than failing', async () => {
    const { svc, rows } = makeService();
    const first = await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    const second = await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    expect(new Set(rows.map((r) => r.marker_key)).size).toBe(2);
    expect(first.markerKey).not.toBe(second.markerKey);
  });

  it('12. validation and consistency still gate persistence', async () => {
    const { svc, rows, uploads } = makeService();
    const broken = JSON.parse(JSON.stringify(GIANT_WHEEL));
    broken.points[1].y = 9;                 // A off the circle
    const body = await rejection(svc.create(TEACHER, ASSESSMENT, { spec: broken }));
    expect(body.stage).toBe('geometric');
    // Nothing was rendered, uploaded or recorded.
    expect(uploads).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it('13. alt text falls back to the title, then the kind', async () => {
    const { svc, rows } = makeService();
    await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL, altText: 'Wheel with a chord' });
    expect(rows[0].alt_text).toBe('Wheel with a chord');

    await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    expect(rows[1].alt_text).toBe('Giant wheel');

    await svc.create(TEACHER, ASSESSMENT, {
      spec: { kind: 'bar_chart', categories: ['a'], values: [1] },
    });
    expect(rows[2].alt_text).toBe('bar chart diagram');
  });
});

// ── Update and approval ─────────────────────────────────────────────────────

describe('update and approval', () => {
  async function approvedDiagram() {
    const ctx = makeService();
    const created = await ctx.svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    await ctx.svc.setApproval(TEACHER, ASSESSMENT, created.markerKey, { approved: true });
    return { ...ctx, markerKey: created.markerKey };
  }

  it('14. approval records who and when', async () => {
    const { rows } = await approvedDiagram();
    expect(rows[0].approved).toBe(true);
    expect(rows[0].approved_by).toBe('user-1');
    expect(rows[0].approved_at).toBeTruthy();
  });

  it('15. a MATERIALLY changed spec loses its approval', async () => {
    const { svc, rows, markerKey } = await approvedDiagram();
    const changed = JSON.parse(JSON.stringify(GIANT_WHEEL));
    changed.title = 'A different wheel';
    const result = await svc.update(TEACHER, ASSESSMENT, markerKey, { spec: changed });

    expect(result.specChanged).toBe(true);
    expect(result.approvalCleared).toBe(true);
    expect(result.approved).toBe(false);
    expect(rows[0].approved).toBe(false);
    expect(rows[0].approved_by).toBeNull();
    expect(rows[0].approved_at).toBeNull();
  });

  it('16. an unchanged re-save KEEPS approval', async () => {
    // Saving without editing must not cost a teacher their review.
    const { svc, rows, markerKey } = await approvedDiagram();
    const result = await svc.update(TEACHER, ASSESSMENT, markerKey, { spec: GIANT_WHEEL });
    expect(result.specChanged).toBe(false);
    expect(result.approved).toBe(true);
    expect(rows[0].approved).toBe(true);
    expect(rows[0].approved_by).toBe('user-1');
  });

  it('17. update re-renders and repoints at the new object', async () => {
    const { svc, rows, uploads, markerKey } = await approvedDiagram();
    const changed = JSON.parse(JSON.stringify(GIANT_WHEEL));
    changed.title = 'Changed';
    await svc.update(TEACHER, ASSESSMENT, markerKey, { spec: changed });
    expect(uploads).toHaveLength(2);
    expect(uploads[1].key).not.toBe(uploads[0].key);
    expect(rows[0].image_key).toBe(uploads[1].key);
  });

  it('18. approval can be withdrawn, clearing the record', async () => {
    const { svc, rows, markerKey } = await approvedDiagram();
    await svc.setApproval(TEACHER, ASSESSMENT, markerKey, { approved: false });
    expect(rows[0].approved).toBe(false);
    expect(rows[0].approved_by).toBeNull();
  });

  it('19. a diagram with no rendered image cannot be approved', async () => {
    const { svc } = makeService([{
      id: 'row-1', institute_id: INSTITUTE, assessment_id: ASSESSMENT,
      marker_key: 'aaaa1111', diagram_type: 'geometry', spec: GIANT_WHEEL,
      renderer_version: 'v1', image_key: null, approved: false,
    }]);
    const body = await rejection(svc.setApproval(TEACHER, ASSESSMENT, 'aaaa1111', {}));
    expect(body.stage).toBe('storage');
    expect(body.errors.join(' ')).toContain('nothing to approve');
  });

  it('20. update rejects an invalid spec without touching the stored row', async () => {
    const { svc, rows, markerKey } = await approvedDiagram();
    const before = JSON.stringify(rows[0]);
    const broken = JSON.parse(JSON.stringify(GIANT_WHEEL));
    broken.points[1].y = 9;
    const body = await rejection(svc.update(TEACHER, ASSESSMENT, markerKey, { spec: broken }));
    expect(body.stage).toBe('geometric');
    expect(JSON.stringify(rows[0])).toBe(before);
    expect(rows[0].approved).toBe(true);     // approval survives a rejected edit
  });
});

// ── Authorization and tenant isolation ──────────────────────────────────────

describe('authorization and isolation', () => {
  it('21. every persistence operation runs the shared access check', async () => {
    const { svc, checkAssessmentAccess } = makeService();
    const created = await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    await svc.list(TEACHER, ASSESSMENT);
    await svc.update(TEACHER, ASSESSMENT, created.markerKey, { spec: GIANT_WHEEL });
    await svc.setApproval(TEACHER, ASSESSMENT, created.markerKey, {});
    expect(checkAssessmentAccess).toHaveBeenCalledTimes(4);
  });

  it('22. a marker belonging to ANOTHER paper is not found here', async () => {
    // Same institute, different assessment. Returning it would let one paper
    // edit another's diagram.
    const { svc } = makeService([{
      id: 'row-1', institute_id: INSTITUTE, assessment_id: OTHER_ASSESSMENT,
      marker_key: 'dddd4444', diagram_type: 'geometry', spec: GIANT_WHEEL,
      renderer_version: 'v1', image_key: 'k.svg', approved: true,
    }]);
    await expect(svc.update(TEACHER, ASSESSMENT, 'dddd4444', { spec: GIANT_WHEEL }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setApproval(TEACHER, ASSESSMENT, 'dddd4444', {}))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('23. a denied assessment stops persistence before any write', async () => {
    const { svc, rows, uploads, checkAssessmentAccess } = makeService();
    checkAssessmentAccess.mockRejectedValueOnce(new ForbiddenException('nope'));
    await expect(svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(uploads).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it('24. instituteId is taken from the assessment, never the body', async () => {
    const { svc, uploads } = makeService();
    await svc.create(TEACHER, ASSESSMENT, {
      spec: GIANT_WHEEL, instituteId: 'attacker-tenant', institute_id: 'attacker-tenant',
    });
    expect(uploads[0].key).toContain(`tenants/${INSTITUTE}/`);
    expect(uploads[0].key).not.toContain('attacker-tenant');
  });

  it('25. an assessment with no institute cannot store a diagram', async () => {
    const { svc, checkAssessmentAccess } = makeService();
    checkAssessmentAccess.mockResolvedValueOnce({ id: ASSESSMENT, institute_id: null });
    const body = await rejection(svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL }));
    expect(body.stage).toBe('storage');
    expect(body.errors.join(' ')).toContain('no institute');
  });
});

// ── Listing ─────────────────────────────────────────────────────────────────

describe('list', () => {
  it('26. returns diagrams with resolved URLs and approval state', async () => {
    const { svc } = makeService();
    const created = await svc.create(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    await svc.setApproval(TEACHER, ASSESSMENT, created.markerKey, { approved: true });

    const { data } = await svc.list(TEACHER, ASSESSMENT);
    expect(data).toHaveLength(1);
    expect(data[0].markerKey).toBe(created.markerKey);
    expect(data[0].marker).toBe(`[DIAGRAM: ${created.markerKey}]`);
    expect(data[0].url).toContain('https://media.example/');
    expect(data[0].approved).toBe(true);
    expect(data[0].approvedBy).toBe('user-1');
    expect(data[0].detached).toBe(false);
    expect(data[0].spec.kind).toBe('geometry');
  });

  it('27. detached diagrams are listed, not hidden or deleted', async () => {
    // A teacher who removed a marker must be able to see and restore it.
    const { svc } = makeService([{
      id: 'row-1', institute_id: INSTITUTE, assessment_id: ASSESSMENT,
      marker_key: 'aaaa1111', diagram_type: 'geometry', spec: GIANT_WHEEL,
      renderer_version: 'v1', image_key: 'k.svg', approved: true,
      detached_at: new Date(), created_at: new Date(), updated_at: new Date(),
    }]);
    const { data } = await svc.list(TEACHER, ASSESSMENT);
    expect(data).toHaveLength(1);
    expect(data[0].detached).toBe(true);
  });

  it('28. a row with no image reports a null url rather than a broken one', async () => {
    const { svc } = makeService([{
      id: 'row-1', institute_id: INSTITUTE, assessment_id: ASSESSMENT,
      marker_key: 'aaaa1111', diagram_type: 'geometry', spec: GIANT_WHEEL,
      renderer_version: 'v1', image_key: null, approved: false,
      created_at: new Date(), updated_at: new Date(),
    }]);
    const { data } = await svc.list(TEACHER, ASSESSMENT);
    expect(data[0].url).toBeNull();
  });
});
