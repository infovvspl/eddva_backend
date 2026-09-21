/**
 * Diagram specification validation.
 *
 * The input is model output: untrusted, frequently malformed, occasionally
 * hostile. Two properties matter more than the rest and are tested hardest.
 *
 * REJECT, NEVER REPAIR — a clamped coordinate or a truncated label produces a
 * diagram that is quietly different from the one asked for, and a quietly
 * wrong diagram on an exam paper is the worst outcome available.
 *
 * NOTHING UNKNOWN SURVIVES — the validator rebuilds the specification from
 * recognised fields, so a `style`, an `href` or a `__proto__` smuggled into
 * the input cannot reach storage or the renderer. That whitelist is what makes
 * "no field can hold a URL" true of the running code and not merely of the
 * type declaration.
 */
import { validateDiagramSpec } from './diagram-spec.validator';
import { DIAGRAM_LIMITS } from './diagram-spec.types';

/** The Giant Wheel construction, used as the running geometry example. */
const GIANT_WHEEL = {
  kind: 'geometry',
  title: 'Giant wheel',
  points: [
    { id: 'O', x: 0, y: 0, label: 'O', labelPosition: 'below-right' },
    { id: 'A', x: -6, y: 8, label: 'A', labelPosition: 'above-left' },
    { id: 'B', x: 6, y: 8, label: 'B', labelPosition: 'above-right' },
    { id: 'M', x: 0, y: 8, label: 'M', labelPosition: 'above' },
    { id: 'C', x: 6, y: -8, label: 'C', labelPosition: 'below-right' },
  ],
  shapes: [
    { type: 'circle', center: 'O', radius: 10 },
    { type: 'chord', circle: 'O', from: 'A', to: 'B', measure: '12 m' },
    { type: 'diameter', circle: 'O', from: 'A', to: 'C' },
    { type: 'segment', from: 'O', to: 'M', measure: '8 m' },
    { type: 'segment', from: 'B', to: 'C', style: 'dashed' },
    { type: 'angle', at: 'M', from: 'O', to: 'B', rightAngle: true },
  ],
  annotations: [{ anchor: ['O', 'A'], text: 'radius 10 m' }],
};

const ok = (input: any) => {
  const r = validateDiagramSpec(input);
  if (!r.valid) throw new Error(`expected valid, got: ${r.errors.join(' | ')}`);
  return r;
};
const fail = (input: any) => {
  const r = validateDiagramSpec(input);
  expect(r.valid).toBe(false);
  expect(r.spec).toBeUndefined();
  expect(r.errors.length).toBeGreaterThan(0);
  return r;
};

// ── The union itself ────────────────────────────────────────────────────────

describe('diagram kind', () => {
  it('1. rejects a non-object', () => {
    for (const input of [null, undefined, 'geometry', 42, [], true]) fail(input);
  });

  it('2. rejects an unsupported kind and names what is supported', () => {
    const r = fail({ kind: 'mandelbrot', points: [], shapes: [] });
    expect(r.errors[0]).toContain('unsupported diagram type');
    expect(r.errors[0]).toContain('geometry');
  });

  it('3. rejects a missing kind', () => {
    fail({ points: [], shapes: [] });
  });
});

// ── The security properties ─────────────────────────────────────────────────

describe('injection resistance', () => {
  it('4. drops unknown fields instead of carrying them through', () => {
    const r = ok({
      ...GIANT_WHEEL,
      onload: 'alert(1)',
      href: 'https://evil.example/x.svg',
      style: 'fill:url(#x)',
      script: '<script>alert(1)</script>',
    });
    const serialized = JSON.stringify(r.spec);
    expect(serialized).not.toContain('onload');
    expect(serialized).not.toContain('evil.example');
    expect(serialized).not.toContain('fill:url');
    expect(serialized).not.toContain('<script>');
  });

  it('5. drops unknown fields nested inside shapes and points', () => {
    const r = ok({
      kind: 'geometry',
      points: [{ id: 'O', x: 0, y: 0, onclick: 'x()', href: 'javascript:1' }],
      shapes: [{ type: 'circle', center: 'O', radius: 5, style: 'solid', filter: 'url(#f)' }],
    });
    const serialized = JSON.stringify(r.spec);
    expect(serialized).not.toContain('onclick');
    expect(serialized).not.toContain('javascript');
    expect(serialized).not.toContain('url(#f)');
  });

  it('6. a prototype-polluting key cannot reach the output', () => {
    const r = ok(JSON.parse(`{
      "kind": "geometry",
      "__proto__": { "polluted": true },
      "points": [{ "id": "O", "x": 0, "y": 0 }],
      "shapes": [{ "type": "circle", "center": "O", "radius": 5 }]
    }`));
    expect(Object.keys(r.spec as any)).toEqual(expect.not.arrayContaining(['__proto__', 'polluted']));
    expect(({} as any).polluted).toBeUndefined();
  });

  it('7. rejects control characters in a label but allows ordinary maths', () => {
    // Angle brackets are legitimate mathematics; the renderer escapes text.
    ok({
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0, label: 'x < 5 & y > 2' }],
      shapes: [{ type: 'circle', center: 'A', radius: 1 }],
    });
    for (const bad of ['a\u0000b', 'a\nb', 'a\u001Fb', 'a\u007Fb']) {
      const r = fail({
        kind: 'geometry',
        points: [{ id: 'A', x: 0, y: 0, label: bad }],
        shapes: [{ type: 'circle', center: 'A', radius: 1 }],
      });
      expect(r.errors.join(' ')).toContain('control characters');
    }
  });

  it('8. rejects identifiers that are not plain identifiers', () => {
    for (const bad of ['', '1A', 'a b', 'a-b', '<svg>', 'a'.repeat(20), '__proto__']) {
      fail({
        kind: 'geometry',
        points: [{ id: bad, x: 0, y: 0 }],
        shapes: [{ type: 'circle', center: bad, radius: 1 }],
      });
    }
  });
});

// ── Limits ──────────────────────────────────────────────────────────────────

describe('limits', () => {
  it('9. rejects non-finite and out-of-range coordinates', () => {
    for (const bad of [NaN, Infinity, -Infinity, '5', null, 1e9]) {
      fail({
        kind: 'geometry',
        points: [{ id: 'A', x: bad, y: 0 }],
        shapes: [{ type: 'circle', center: 'A', radius: 1 }],
      });
    }
  });

  it('10. rejects too many points and too many shapes', () => {
    const many = Array.from({ length: DIAGRAM_LIMITS.MAX_POINTS + 1 }, (_v, i) =>
      ({ id: `P${i}`, x: i, y: 0 }));
    const r = fail({ kind: 'geometry', points: many, shapes: [{ type: 'circle', center: 'P0', radius: 1 }] });
    expect(r.errors.join(' ')).toContain('at most');

    const shapes = Array.from({ length: DIAGRAM_LIMITS.MAX_SHAPES + 1 }, () =>
      ({ type: 'circle', center: 'A', radius: 1 }));
    fail({ kind: 'geometry', points: [{ id: 'A', x: 0, y: 0 }], shapes });
  });

  it('11. rejects an over-long label rather than truncating it', () => {
    const long = 'x'.repeat(DIAGRAM_LIMITS.MAX_LABEL_CHARS + 1);
    const r = fail({
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0, label: long }],
      shapes: [{ type: 'circle', center: 'A', radius: 1 }],
    });
    expect(r.errors.join(' ')).toContain('at most');
  });

  it('12. allows a longer title than a label', () => {
    ok({ ...GIANT_WHEEL, title: 'T'.repeat(DIAGRAM_LIMITS.MAX_TITLE_CHARS) });
    fail({ ...GIANT_WHEEL, title: 'T'.repeat(DIAGRAM_LIMITS.MAX_TITLE_CHARS + 1) });
  });
});

// ── Geometry ────────────────────────────────────────────────────────────────

describe('geometry', () => {
  it('13. accepts the Giant Wheel construction', () => {
    const r = ok(GIANT_WHEEL);
    expect(r.spec!.kind).toBe('geometry');
    expect((r.spec as any).points).toHaveLength(5);
    expect((r.spec as any).shapes).toHaveLength(6);
  });

  it('14. rejects a shape referring to a point that was never declared', () => {
    const r = fail({
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0 }],
      shapes: [{ type: 'segment', from: 'A', to: 'Z' }],
    });
    expect(r.errors.join(' ')).toContain('unknown point "Z"');
  });

  it('15. rejects a chord on a circle that does not exist', () => {
    const r = fail({
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 1 }],
      shapes: [{ type: 'chord', circle: 'Q', from: 'A', to: 'B' }],
    });
    expect(r.errors.join(' ')).toContain('unknown point "Q"');
  });

  it('16. rejects a degenerate segment, angle and polygon', () => {
    const base = {
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 0 }],
    };
    fail({ ...base, shapes: [{ type: 'segment', from: 'A', to: 'A' }] });
    fail({ ...base, shapes: [{ type: 'angle', at: 'A', from: 'A', to: 'B' }] });
    fail({ ...base, shapes: [{ type: 'polygon', vertices: ['A', 'B'] }] });
    fail({ ...base, shapes: [{ type: 'polygon', vertices: ['A', 'B', 'A'] }] });
  });

  it('17. a triangle is a three-vertex polygon', () => {
    const r = ok({
      kind: 'geometry',
      points: [
        { id: 'A', x: 0, y: 0, label: 'A' },
        { id: 'B', x: 3, y: 0, label: 'B' },
        { id: 'C', x: 3, y: 4, label: 'C' },
      ],
      shapes: [
        { type: 'polygon', vertices: ['A', 'B', 'C'] },
        { type: 'angle', at: 'B', from: 'A', to: 'C', rightAngle: true },
      ],
    });
    expect((r.spec as any).shapes[0].vertices).toEqual(['A', 'B', 'C']);
  });

  it('18. rejects a non-positive radius and tangent length', () => {
    const pts = [{ id: 'O', x: 0, y: 0 }, { id: 'P', x: 5, y: 0 }];
    fail({ kind: 'geometry', points: pts, shapes: [{ type: 'circle', center: 'O', radius: 0 }] });
    fail({ kind: 'geometry', points: pts, shapes: [{ type: 'circle', center: 'O', radius: -3 }] });
    fail({
      kind: 'geometry', points: pts,
      shapes: [{ type: 'circle', center: 'O', radius: 5 }, { type: 'tangent', circle: 'O', at: 'P', length: 0 }],
    });
  });

  it('19. accepts every declared geometry primitive', () => {
    const r = ok({
      kind: 'geometry',
      points: [
        { id: 'O', x: 0, y: 0 }, { id: 'A', x: -6, y: 8 }, { id: 'B', x: 6, y: 8 },
        { id: 'C', x: 6, y: -8 }, { id: 'M', x: 0, y: 8 }, { id: 'T', x: 10, y: 0 },
      ],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'chord', circle: 'O', from: 'A', to: 'B' },
        { type: 'diameter', circle: 'O', from: 'A', to: 'C' },
        { type: 'radius', circle: 'O', to: 'B', measure: '10 m' },
        { type: 'tangent', circle: 'O', at: 'T', length: 6 },
        { type: 'secant', circle: 'O', from: 'A', to: 'C' },
        { type: 'perpendicular', from: 'O', segment: ['A', 'B'], foot: 'M' },
        { type: 'angle', at: 'M', from: 'O', to: 'B', rightAngle: true },
        { type: 'segment', from: 'B', to: 'C', arrow: 'end', style: 'dotted' },
        { type: 'polygon', vertices: ['A', 'B', 'C'] },
      ],
    });
    expect((r.spec as any).shapes).toHaveLength(10);
  });

  it('20. rejects an unknown shape type by name', () => {
    const r = fail({
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0 }],
      shapes: [{ type: 'hyperbola', center: 'A' }],
    });
    expect(r.errors.join(' ')).toContain('unsupported shape type "hyperbola"');
  });

  it('21. requires at least one point and one shape', () => {
    fail({ kind: 'geometry', points: [], shapes: [] });
    fail({ kind: 'geometry', points: [{ id: 'A', x: 0, y: 0 }], shapes: [] });
  });

  it('22. rejects duplicate point ids', () => {
    const r = fail({
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0 }, { id: 'A', x: 1, y: 1 }],
      shapes: [{ type: 'circle', center: 'A', radius: 1 }],
    });
    expect(r.errors.join(' ')).toContain('duplicate point id');
  });

  it('23. rejects an annotation anchored to an unknown point', () => {
    fail({ ...GIANT_WHEEL, annotations: [{ anchor: ['Z'], text: 'nope' }] });
  });
});

// ── Mathematics ─────────────────────────────────────────────────────────────

describe('cartesian', () => {
  it('24. accepts axes with plotted functions', () => {
    const r = ok({
      kind: 'cartesian',
      xRange: [-5, 5], yRange: [-10, 10], grid: true,
      xLabel: 'x', yLabel: 'y',
      functions: [
        { form: 'quadratic', coefficients: [1, 0, -4], label: 'y = x² − 4' },
        { form: 'linear', coefficients: [2, 1], style: 'dashed' },
      ],
    });
    expect((r.spec as any).functions).toHaveLength(2);
  });

  it('25. there is no expression string to evaluate', () => {
    // A curve is a named form plus coefficients, so no parser and no eval
    // ever sees model output.
    const r = fail({
      kind: 'cartesian', xRange: [-5, 5], yRange: [-5, 5],
      functions: [{ form: 'custom', expression: 'process.exit(1)', coefficients: [1] }],
    });
    expect(r.errors.join(' ')).toContain('must be one of');
    expect(JSON.stringify(r)).not.toContain('process.exit');
  });

  it('26. enforces the exact coefficient count for each form', () => {
    const base = { kind: 'cartesian', xRange: [-5, 5], yRange: [-5, 5] };
    fail({ ...base, functions: [{ form: 'quadratic', coefficients: [1, 2] }] });
    fail({ ...base, functions: [{ form: 'linear', coefficients: [1, 2, 3] }] });
    ok({ ...base, functions: [{ form: 'cubic', coefficients: [1, 0, 0, 0] }] });
  });

  it('27. rejects mathematically empty curves', () => {
    const base = { kind: 'cartesian', xRange: [-5, 5], yRange: [-5, 5] };
    fail({ ...base, functions: [{ form: 'reciprocal', coefficients: [0] }] });
    fail({ ...base, functions: [{ form: 'exponential', coefficients: [1, 0] }] });
    fail({ ...base, functions: [{ form: 'exponential', coefficients: [1, -2] }] });
  });

  it('28. rejects an inverted or zero-width range', () => {
    fail({ kind: 'cartesian', xRange: [5, -5], yRange: [-5, 5] });
    fail({ kind: 'cartesian', xRange: [0, 0], yRange: [-5, 5] });
    fail({ kind: 'cartesian', xRange: [-5, 5], yRange: [10, 1] });
  });

  it('29. a straight line joins two declared points', () => {
    const r = ok({
      kind: 'cartesian', xRange: [0, 10], yRange: [0, 10],
      points: [{ id: 'P', x: 1, y: 1 }, { id: 'Q', x: 8, y: 6 }],
      lines: [{ from: 'P', to: 'Q', label: 'PQ', extend: true }],
    });
    expect((r.spec as any).lines[0]).toEqual({ from: 'P', to: 'Q', label: 'PQ', extend: true });
    fail({
      kind: 'cartesian', xRange: [0, 10], yRange: [0, 10],
      points: [{ id: 'P', x: 1, y: 1 }],
      lines: [{ from: 'P', to: 'P' }],
    });
  });
});

describe('bar chart and line graph', () => {
  it('30. accepts categories with matching values', () => {
    const r = ok({
      kind: 'bar_chart',
      categories: ['Asha', 'Ravi', 'Meera'],
      values: [42, 35, 48],
      yLabel: 'Marks', showValues: true,
    });
    expect((r.spec as any).values).toEqual([42, 35, 48]);
  });

  it('31. rejects a category/value length mismatch', () => {
    const r = fail({ kind: 'bar_chart', categories: ['a', 'b', 'c'], values: [1, 2] });
    expect(r.errors.join(' ')).toContain('one value per category');
  });

  it('32. rejects a yMax below the tallest bar', () => {
    fail({ kind: 'bar_chart', categories: ['a'], values: [50], yMax: 10 });
    ok({ kind: 'bar_chart', categories: ['a'], values: [50], yMax: 60 });
  });

  it('33. requires at least two points in a line series', () => {
    fail({ kind: 'line_graph', series: [{ points: [{ x: 0, y: 0 }] }] });
    ok({ kind: 'line_graph', series: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 2 }], markers: true }] });
  });

  it('34. rejects too many series', () => {
    const series = Array.from({ length: DIAGRAM_LIMITS.MAX_SERIES + 1 }, () =>
      ({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }));
    fail({ kind: 'line_graph', series });
  });
});

// ── Physics ─────────────────────────────────────────────────────────────────

describe('ray diagram', () => {
  it('35. accepts a concave mirror construction', () => {
    const r = ok({
      kind: 'ray_diagram', device: 'concave_mirror',
      focalLength: 10, objectDistance: 25, objectHeight: 5,
      showPrincipalRays: true, labels: { object: 'AB', focus: 'F' },
    });
    expect((r.spec as any).device).toBe('concave_mirror');
  });

  it('36. rejects an unsupported optical device', () => {
    fail({ kind: 'ray_diagram', device: 'prism', focalLength: 10, objectDistance: 20, objectHeight: 5 });
  });

  it('37. rejects an object at the focal point, where no image forms', () => {
    const r = fail({
      kind: 'ray_diagram', device: 'convex_lens',
      focalLength: 10, objectDistance: 10, objectHeight: 4,
    });
    expect(r.errors.join(' ')).toContain('no image');
  });

  it('38. rejects non-positive optical measurements', () => {
    fail({ kind: 'ray_diagram', device: 'convex_lens', focalLength: 0, objectDistance: 20, objectHeight: 4 });
    fail({ kind: 'ray_diagram', device: 'convex_lens', focalLength: 10, objectDistance: -20, objectHeight: 4 });
    fail({ kind: 'ray_diagram', device: 'convex_lens', focalLength: 10, objectDistance: 20, objectHeight: 0 });
  });
});

describe('force diagram', () => {
  it('39. accepts a body with labelled forces', () => {
    const r = ok({
      kind: 'force_diagram',
      body: { shape: 'block', label: 'Trolley' },
      forces: [
        { label: 'Weight', magnitude: 50, angleDeg: -90 },
        { label: 'Normal', magnitude: 50, angleDeg: 90 },
        { label: 'Push', magnitude: 20, angleDeg: 0 },
      ],
      showResultant: true,
    });
    expect((r.spec as any).forces).toHaveLength(3);
  });

  it('40. rejects a missing body, bad shape, and impossible force', () => {
    fail({ kind: 'force_diagram', forces: [{ magnitude: 1, angleDeg: 0 }] });
    fail({ kind: 'force_diagram', body: { shape: 'triangle' }, forces: [{ magnitude: 1, angleDeg: 0 }] });
    fail({ kind: 'force_diagram', body: { shape: 'block' }, forces: [{ magnitude: 0, angleDeg: 0 }] });
    fail({ kind: 'force_diagram', body: { shape: 'block' }, forces: [{ magnitude: 5, angleDeg: 720 }] });
  });
});

// ── Templates ───────────────────────────────────────────────────────────────

describe('template diagrams', () => {
  it('41. accepts a known template with relabelled slots', () => {
    const r = ok({
      kind: 'template', template: 'plant_cell',
      labels: { nucleus: 'Nucleus', wall: 'Cell wall' },
      hideLabels: ['vacuole'],
    });
    expect((r.spec as any).template).toBe('plant_cell');
    expect((r.spec as any).labels.wall).toBe('Cell wall');
  });

  it('42. rejects an unknown template — there is no path or URL to supply', () => {
    const r = fail({ kind: 'template', template: '../../etc/passwd' });
    expect(r.errors.join(' ')).toContain('must be one of');
    fail({ kind: 'template', template: 'https://evil.example/a.svg' });
  });

  it('43. rejects a slot name that is not an identifier', () => {
    fail({ kind: 'template', template: 'animal_cell', labels: { 'a b': 'x' } });
    fail({ kind: 'template', template: 'animal_cell', hideLabels: ['<svg>'] });
  });
});

// ── Error reporting ─────────────────────────────────────────────────────────

describe('error reporting', () => {
  it('44. reports every problem, not only the first', () => {
    const r = fail({
      kind: 'geometry',
      points: [
        { id: 'A', x: 'nope', y: 0 },
        { id: '1bad', x: 0, y: 0 },
      ],
      shapes: [{ type: 'circle', center: 'A', radius: -1 }],
    });
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('45. every message names the field path that needs fixing', () => {
    const r = fail({
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0 }],
      shapes: [{ type: 'circle', center: 'A', radius: 'big' }],
    });
    expect(r.errors[0]).toMatch(/^shapes\[0\]\.radius: /);
  });

  it('46. a valid spec reports no errors and returns a new object', () => {
    const input = { ...GIANT_WHEEL };
    const r = ok(input);
    expect(r.errors).toEqual([]);
    expect(r.spec).not.toBe(input);
    expect((r.spec as any).points).not.toBe(input.points);
  });
});
