/**
 * Diagram backend integration.
 *
 * What matters here is not that each module works — Phases 2, 3 and 4 already
 * pin that — but that they are SEQUENCED correctly and gated correctly.
 *
 * The order is a chain of gates: authorize, then structural validation, then
 * geometric consistency, then render. Each must be able to stop the next. A
 * well-formed but geometrically false construction renders perfectly and looks
 * like a real diagram, so "consistency runs before render" is not a nicety —
 * it is the only thing standing between a model's arithmetic error and a wrong
 * figure on an exam paper.
 *
 * And the access check must be the SAME one the rest of the assessment module
 * uses, not a second implementation of it.
 */
import { UnprocessableEntityException, ForbiddenException } from '@nestjs/common';
import { SchoolDiagramService } from './school-diagram.service';

const ASSESSMENT = 'aa11bb22-0000-4000-8000-000000000001';
const INSTITUTE = 'e9f3592d-851a-43be-9361-574e57722703';

/** A correct Giant Wheel: radius 10, chord AB = 12, OM = 8, C opposite A. */
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
    { type: 'chord', circle: 'O', from: 'A', to: 'B', measure: '12 m' },
    { type: 'diameter', circle: 'O', from: 'A', to: 'C' },
    { type: 'perpendicular', from: 'O', segment: ['A', 'B'], foot: 'M' },
    { type: 'segment', from: 'B', to: 'C' },
  ],
};

function makeService(accessImpl?: jest.Mock) {
  const checkAssessmentAccess = accessImpl
    ?? jest.fn(async () => ({ id: ASSESSMENT, institute_id: INSTITUTE }));
  const assessments: any = { checkAssessmentAccess };
  // preview, validate and capabilities persist nothing, so the datasource and
  // object store are present only to satisfy construction. A call to either
  // from these paths would be a bug, and would surface here as a TypeError.
  const ds: any = { query: jest.fn(async () => []) };
  const s3: any = { upload: jest.fn(), toPublicUrl: jest.fn() };
  return { svc: new SchoolDiagramService(ds, assessments, s3), checkAssessmentAccess, ds, s3 };
}

const TEACHER = { id: 'u1', role: 'TEACHER', instituteId: INSTITUTE };

/** Capture the 422 body a rejection carries. */
async function rejection(promise: Promise<any>) {
  try {
    await promise;
  } catch (err: any) {
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    return err.getResponse();
  }
  throw new Error('expected the request to be rejected');
}

// ── Authorization and tenant isolation ──────────────────────────────────────

describe('authorization', () => {
  it('1. every route runs the shared assessment access check first', async () => {
    const { svc, checkAssessmentAccess } = makeService();
    await svc.preview(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    await svc.validate(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    await svc.capabilities(TEACHER, ASSESSMENT);
    expect(checkAssessmentAccess).toHaveBeenCalledTimes(3);
    for (const call of checkAssessmentAccess.mock.calls) {
      expect(call[0]).toBe(TEACHER);
      expect(call[1]).toBe(ASSESSMENT);
    }
  });

  it('2. a denied assessment stops the request before any work is done', async () => {
    const denied = jest.fn(async () => { throw new ForbiddenException('nope'); });
    const { svc } = makeService(denied);
    await expect(svc.preview(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL }))
      .rejects.toBeInstanceOf(ForbiddenException);
    // Not a 422: this is an authorization failure, not a bad specification.
    await expect(svc.validate(TEACHER, ASSESSMENT, { spec: {} }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('3. instituteId is NEVER taken from the request body', async () => {
    const { svc, checkAssessmentAccess } = makeService();
    await svc.preview(TEACHER, ASSESSMENT, {
      spec: GIANT_WHEEL,
      instituteId: 'attacker-controlled-tenant',
      institute_id: 'attacker-controlled-tenant',
    });
    // The only tenant input is the assessment row the access check returned.
    const passed = JSON.stringify(checkAssessmentAccess.mock.calls[0]);
    expect(passed).not.toContain('attacker-controlled-tenant');
  });

  it('4. an assessment id is required for every operation', async () => {
    // The routes nest under :assessmentId, so the check cannot be skipped by
    // omitting it — it simply resolves nothing and the check rejects.
    const missing = jest.fn(async (_u: any, id: string) => {
      if (!id) throw new ForbiddenException('no assessment');
      return { id, institute_id: INSTITUTE };
    });
    const { svc } = makeService(missing);
    await expect(svc.preview(TEACHER, '', { spec: GIANT_WHEEL }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ── Sequencing: the gates, in order ─────────────────────────────────────────

describe('pipeline sequencing', () => {
  it('5. a valid, consistent spec renders', async () => {
    const { svc } = makeService();
    const result = await svc.preview(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    expect(result.svg.startsWith('<svg ')).toBe(true);
    expect(result.rendererVersion).toBe('v1');
    expect(result.width).toBeGreaterThan(0);
  });

  it('6. a structurally invalid spec is rejected at the structural stage', async () => {
    const { svc } = makeService();
    const body = await rejection(svc.preview(TEACHER, ASSESSMENT, {
      spec: { kind: 'geometry', points: [{ id: 'A', x: 0, y: 0 }], shapes: [{ type: 'circle', center: 'Z', radius: 5 }] },
    }));
    expect(body.stage).toBe('structural');
    expect(body.success).toBe(false);
    expect(body.errors.join(' ')).toContain('unknown point "Z"');
  });

  it('7. a well-formed but geometrically FALSE spec never reaches the renderer', async () => {
    // This is the whole reason consistency runs before rendering: this
    // specification draws perfectly and is simply not the stated problem.
    const broken = JSON.parse(JSON.stringify(GIANT_WHEEL));
    broken.points[1].y = 9;                       // A no longer on the circle
    const { svc } = makeService();
    const body = await rejection(svc.preview(TEACHER, ASSESSMENT, { spec: broken }));
    expect(body.stage).toBe('geometric');
    expect(body.errors.join(' ')).toContain('does not lie on the circle');
    expect(body.errors[0]).toMatch(/^shapes\[\d+\]: /);
  });

  it('8. structural failure takes precedence over geometric failure', async () => {
    // A spec that is both malformed and geometrically wrong reports the
    // structural problem: fixing the shape is a prerequisite for judging it.
    const { svc } = makeService();
    const body = await rejection(svc.preview(TEACHER, ASSESSMENT, {
      spec: {
        kind: 'geometry',
        points: [{ id: 'O', x: 0, y: 0 }, { id: 'A', x: -6, y: 9 }],
        shapes: [
          { type: 'circle', center: 'O', radius: 'ten' },
          { type: 'chord', circle: 'O', from: 'A', to: 'A' },
        ],
      },
    }));
    expect(body.stage).toBe('structural');
  });

  it('9. a render-stage failure is reported as such', async () => {
    // An unknown template slot is a relationship the schema cannot express,
    // so only the renderer can catch it.
    const { svc } = makeService();
    const body = await rejection(svc.preview(TEACHER, ASSESSMENT, {
      spec: { kind: 'template', template: 'plant_cell', labels: { golgi: 'Golgi body' } },
    }));
    expect(body.stage).toBe('render');
    expect(body.errors.join(' ')).toContain('no slot "golgi"');
  });

  it('10. validate runs the same gates without rendering', async () => {
    const { svc } = makeService();
    const ok = await svc.validate(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    expect(ok.data.valid).toBe(true);
    expect(ok.data.kind).toBe('geometry');
    expect((ok.data as any).svg).toBeUndefined();

    const broken = JSON.parse(JSON.stringify(GIANT_WHEEL));
    broken.points[1].y = 9;
    const body = await rejection(svc.validate(TEACHER, ASSESSMENT, { spec: broken }));
    expect(body.stage).toBe('geometric');
  });
});

// ── Error contract ──────────────────────────────────────────────────────────

describe('error contract', () => {
  it('11. every rejection names a stage and carries field paths', async () => {
    const { svc } = makeService();
    for (const spec of [
      { kind: 'nope' },
      { kind: 'geometry', points: [], shapes: [] },
      { kind: 'bar_chart', categories: ['a', 'b'], values: [1] },
    ]) {
      const body = await rejection(svc.preview(TEACHER, ASSESSMENT, { spec }));
      expect(['structural', 'geometric', 'render']).toContain(body.stage);
      expect(Array.isArray(body.errors)).toBe(true);
      expect(body.errors.length).toBeGreaterThan(0);
      for (const message of body.errors) expect(message).toContain(':');
    }
  });

  it('12. a missing or non-object spec is rejected, not defaulted', async () => {
    const { svc } = makeService();
    for (const body of [{}, { spec: null }, { spec: 'circle' }, { spec: [] }]) {
      const rejected = await rejection(svc.preview(TEACHER, ASSESSMENT, body));
      expect(rejected.stage).toBe('structural');
    }
  });

  it('13. unverifiable relationships are warnings, never errors', async () => {
    // The Giant Wheel carries a "12 m" measurement, which the schema has no
    // unit or scale to check against. That must not fail the request, and
    // must not be silently hidden either.
    const { svc } = makeService();
    const result = await svc.preview(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL });
    expect(result.warnings.join(' ')).toContain('no unit or scale');
  });

  it('14. warnings accompany a geometric rejection too', async () => {
    const broken = JSON.parse(JSON.stringify(GIANT_WHEEL));
    broken.points[1].y = 9;
    const { svc } = makeService();
    const body = await rejection(svc.preview(TEACHER, ASSESSMENT, { spec: broken }));
    expect(body.warnings.join(' ')).toContain('measurement label');
  });
});

// ── No repair ───────────────────────────────────────────────────────────────

describe('nothing is repaired', () => {
  it('15. a rejected spec is returned to the caller untouched', async () => {
    const broken = JSON.parse(JSON.stringify(GIANT_WHEEL));
    broken.points[1].y = 9;
    const snapshot = JSON.stringify(broken);
    const { svc } = makeService();
    await rejection(svc.preview(TEACHER, ASSESSMENT, { spec: broken }));
    expect(JSON.stringify(broken)).toBe(snapshot);
    expect(broken.points[1].y).toBe(9);          // A was not moved back
  });

  it('16. unknown fields are dropped, not carried into the render', async () => {
    const { svc } = makeService();
    const result = await svc.preview(TEACHER, ASSESSMENT, {
      spec: { ...GIANT_WHEEL, href: 'https://evil.example/x.svg', onload: 'alert(1)' },
    });
    expect(result.svg).not.toContain('evil.example');
    expect(result.svg).not.toContain('onload');
  });
});

// ── Canvas options and capabilities ─────────────────────────────────────────

describe('options and capabilities', () => {
  it('17. canvas size is honoured and bounded', async () => {
    const { svc } = makeService();
    expect((await svc.preview(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL, width: 800, height: 600 })).width)
      .toBe(800);
    // Absurd or hostile values fall back rather than being obeyed.
    expect((await svc.preview(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL, width: -1 })).width)
      .toBe(560);
    expect((await svc.preview(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL, width: 'huge' })).width)
      .toBe(560);
    expect((await svc.preview(TEACHER, ASSESSMENT, { spec: GIANT_WHEEL, width: 1e9 })).width)
      .toBe(2000);
  });

  it('18. capabilities are read from the schema, not restated', async () => {
    const { svc } = makeService();
    const { data } = await svc.capabilities(TEACHER, ASSESSMENT);
    expect(data.kinds).toContain('geometry');
    expect(data.kinds).toContain('ray_diagram');
    expect(data.rendererVersion).toBe('v1');
    const plant = data.templates.find((t: any) => t.id === 'plant_cell');
    expect(plant.slots.map((s: any) => s.id)).toContain('nucleus');
    expect(data.functionForms.find((f: any) => f.form === 'quadratic').coefficients).toBe(3);
    expect(data.limits.maxPoints).toBeGreaterThan(0);
  });

  it('19. every advertised kind can actually be previewed', async () => {
    // Guards against the capability list drifting from what works.
    const { svc } = makeService();
    const samples: Record<string, any> = {
      geometry: GIANT_WHEEL,
      cartesian: { kind: 'cartesian', xRange: [-4, 4], yRange: [-4, 4] },
      bar_chart: { kind: 'bar_chart', categories: ['a'], values: [1] },
      line_graph: { kind: 'line_graph', series: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] },
      ray_diagram: { kind: 'ray_diagram', device: 'convex_lens', focalLength: 8, objectDistance: 20, objectHeight: 4 },
      force_diagram: { kind: 'force_diagram', body: { shape: 'block' }, forces: [{ magnitude: 5, angleDeg: 0 }] },
      template: { kind: 'template', template: 'neuron' },
    };
    const { data } = await svc.capabilities(TEACHER, ASSESSMENT);
    for (const kind of data.kinds) {
      const result = await svc.preview(TEACHER, ASSESSMENT, { spec: samples[kind] });
      expect(result.svg).toContain('<svg ');
    }
  });

  it('20. every advertised template renders with its advertised slots', async () => {
    const { svc } = makeService();
    const { data } = await svc.capabilities(TEACHER, ASSESSMENT);
    for (const template of data.templates) {
      const labels: Record<string, string> = {};
      for (const slot of template.slots) labels[slot.id] = `${slot.defaultLabel} X`;
      const result = await svc.preview(TEACHER, ASSESSMENT, {
        spec: { kind: 'template', template: template.id, labels },
      });
      expect(result.svg).toContain('<svg ');
    }
  });
});
