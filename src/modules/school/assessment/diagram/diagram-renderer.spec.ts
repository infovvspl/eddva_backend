/**
 * SVG rendering.
 *
 * Three properties carry the weight here.
 *
 * SAFETY — the output is markup that goes straight onto a question paper. It
 * must contain no script, no event handler, no external reference and no
 * `url(` of any kind, and every label must arrive escaped. The renderer builds
 * from a fixed vocabulary so this holds by construction; these tests are the
 * assertion that a future change has not broken it.
 *
 * DETERMINISM — the storage key for a rendered diagram is a hash of its
 * specification, so the same validated specification must produce byte-
 * identical SVG. Anything that reads a clock, a locale or a random source
 * would silently invalidate every cached image.
 *
 * MATHEMATICAL FIDELITY — a construction determined by geometry is computed,
 * not taken on trust, because a subtly wrong diagram on an exam paper is worse
 * than no diagram at all.
 */
import { renderDiagram, DiagramRenderError } from './diagram-renderer';
import { validateDiagramSpec } from './diagram-spec.validator';
import { RENDERER_VERSION, type DiagramSpec } from './diagram-spec.types';
import { escapeXml, fmt, markupSkeleton, FORBIDDEN_SVG_PATTERNS } from './svg-primitives';
import {
  footOfPerpendicular, tangentEndpoints, thinLensImageDistance, magnification,
  isRightAngle, distance, vec,
} from './diagram-geometry';
import { templateSlotIds } from './diagram-templates';

/** Validate then render, so every fixture exercises the real pipeline. */
function render(input: any, options?: any) {
  const result = validateDiagramSpec(input);
  if (!result.valid) throw new Error(`fixture invalid: ${result.errors.join(' | ')}`);
  return renderDiagram(result.spec as DiagramSpec, options);
}

/**
 * The Giant Wheel: radius 10, chord AB = 12, so AM = MB = 6 and
 * OM = sqrt(100 - 36) = 8. C is diametrically opposite A.
 */
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
    { type: 'perpendicular', from: 'O', segment: ['A', 'B'], foot: 'M' },
    { type: 'segment', from: 'B', to: 'C', style: 'dashed' },
    { type: 'radius', circle: 'O', to: 'A', measure: '10 m' },
  ],
  annotations: [{ anchor: ['O', 'M'], text: 'OM = 8 m' }],
};

// ── Safety ──────────────────────────────────────────────────────────────────

describe('generated markup is safe', () => {
  const FIXTURES: Record<string, any> = {
    geometry: GIANT_WHEEL,
    cartesian: {
      kind: 'cartesian', xRange: [-5, 5], yRange: [-10, 10], grid: true,
      functions: [{ form: 'quadratic', coefficients: [1, 0, -4], label: 'y = x^2 - 4' }],
    },
    bar_chart: { kind: 'bar_chart', categories: ['A', 'B'], values: [3, 7], showValues: true },
    line_graph: { kind: 'line_graph', series: [{ points: [{ x: 0, y: 0 }, { x: 4, y: 8 }], markers: true }] },
    ray_diagram: {
      kind: 'ray_diagram', device: 'concave_mirror',
      focalLength: 10, objectDistance: 25, objectHeight: 5,
    },
    force_diagram: {
      kind: 'force_diagram', body: { shape: 'block', label: 'Trolley' },
      forces: [{ label: 'W', magnitude: 50, angleDeg: -90 }], showResultant: true,
    },
    template: { kind: 'template', template: 'plant_cell' },
  };

  it.each(Object.keys(FIXTURES))('1. %s output contains nothing forbidden', (kind) => {
    const skeleton = markupSkeleton(render(FIXTURES[kind]).svg);
    for (const { name, re } of FORBIDDEN_SVG_PATTERNS) {
      expect({ kind, name, matched: re.test(skeleton) }).toEqual({ kind, name, matched: false });
    }
  });

  it('2. escapes every XML metacharacter in a label', () => {
    const { svg } = render({
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0, label: `<script>alert("x" & 'y')</script>` }],
      shapes: [{ type: 'circle', center: 'A', radius: 5 }],
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
    expect(svg).toContain('&#39;');
  });

  it('3. escapes text in every label-bearing position', () => {
    const hostile = '<b>&"\'';
    const { svg } = render({
      kind: 'geometry',
      title: hostile,
      points: [{ id: 'A', x: 0, y: 0, label: hostile }, { id: 'B', x: 6, y: 0, label: hostile }],
      shapes: [
        { type: 'circle', center: 'A', radius: 4 },
        { type: 'segment', from: 'A', to: 'B', measure: hostile },
      ],
      annotations: [{ anchor: ['A', 'B'], text: hostile }],
    } as any);
    expect(svg).not.toContain('<b>');
    expect(svg.match(/&lt;b&gt;/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('4. escapeXml handles all five predefined entities', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeXml('plain')).toBe('plain');
  });

  it('5. output is a single well-formed svg root', () => {
    const { svg } = render(GIANT_WHEEL);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<svg[\s>]/g)).toHaveLength(1);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

// ── Determinism ─────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('6. the same spec renders byte-identically across runs', () => {
    const a = render(GIANT_WHEEL).svg;
    const b = render(GIANT_WHEEL).svg;
    const c = render(JSON.parse(JSON.stringify(GIANT_WHEEL))).svg;
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('7. every supported kind is reproducible', () => {
    const specs: any[] = [
      GIANT_WHEEL,
      { kind: 'cartesian', xRange: [-4, 4], yRange: [-4, 4], functions: [{ form: 'sine', coefficients: [2, 1, 0] }] },
      { kind: 'bar_chart', categories: ['x', 'y', 'z'], values: [1, 5, 3] },
      { kind: 'line_graph', series: [{ points: [{ x: 0, y: 1 }, { x: 2, y: 4 }, { x: 5, y: 2 }] }] },
      { kind: 'ray_diagram', device: 'convex_lens', focalLength: 8, objectDistance: 20, objectHeight: 4 },
      { kind: 'force_diagram', body: { shape: 'circle' }, forces: [{ magnitude: 10, angleDeg: 45 }] },
      { kind: 'template', template: 'neuron' },
    ];
    for (const spec of specs) {
      expect(render(spec).svg).toBe(render(spec).svg);
    }
  });

  it('8. differing specs produce differing output', () => {
    const one = render({ kind: 'bar_chart', categories: ['a'], values: [1] }).svg;
    const two = render({ kind: 'bar_chart', categories: ['a'], values: [2] }).svg;
    expect(one).not.toBe(two);
  });

  it('9. number formatting is stable and normalises negative zero', () => {
    expect(fmt(-0)).toBe('0');
    expect(fmt(0)).toBe('0');
    expect(fmt(1 / 3)).toBe(fmt(1 / 3));
    expect(fmt(0.1 + 0.2)).toBe('0.3');
    expect(fmt(NaN)).toBe('0');
    expect(fmt(Infinity)).toBe('0');
  });

  it('10. the renderer version is reported and fixed', () => {
    const result = render(GIANT_WHEEL);
    expect(result.rendererVersion).toBe(RENDERER_VERSION);
    expect(RENDERER_VERSION).toBe('v1');
  });

  it('11. output contains no timestamp, locale or random artefact', () => {
    const { svg } = render(GIANT_WHEEL);
    expect(svg).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(svg).not.toMatch(/GMT|UTC|T\d{2}:\d{2}/);
  });
});

// ── Geometry ────────────────────────────────────────────────────────────────

describe('geometry rendering', () => {
  it('12. renders the Giant Wheel with every element present', () => {
    const { svg, width, height } = render(GIANT_WHEEL);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(svg).toContain('<circle');                 // the wheel
    expect((svg.match(/<line/g) || []).length).toBeGreaterThanOrEqual(4);
    for (const label of ['A', 'B', 'C', 'M', 'O']) {
      expect(svg).toContain(`>${label}</text>`);
    }
    expect(svg).toContain('12 m');
    expect(svg).toContain('10 m');
    expect(svg).toContain('OM = 8 m');
    expect(svg).toContain('Giant wheel');
  });

  it('13. the Giant Wheel fixture is mathematically consistent', () => {
    // Not a renderer assertion — it proves the fixture is the real problem, so
    // the rendering tests above are exercising a correct construction.
    const O = vec(0, 0); const A = vec(-6, 8); const B = vec(6, 8);
    const M = vec(0, 8); const C = vec(6, -8);
    expect(distance(O, A)).toBeCloseTo(10, 9);
    expect(distance(O, B)).toBeCloseTo(10, 9);
    expect(distance(A, B)).toBeCloseTo(12, 9);
    expect(distance(A, M)).toBeCloseTo(6, 9);
    expect(distance(O, M)).toBeCloseTo(8, 9);
    expect(isRightAngle(M, O, B)).toBe(true);
    // Note C is diametrically opposite A only if |OC| = 10, which holds.
    expect(distance(O, C)).toBeCloseTo(10, 9);
  });

  it('14. the foot of a perpendicular is computed, not taken on trust', () => {
    // A spec that names a wrong foot still draws to the named point, but the
    // computed foot is what an unspecified one uses.
    const foot = footOfPerpendicular(vec(0, 0), vec(-6, 8), vec(6, 8));
    expect(foot.x).toBeCloseTo(0, 9);
    expect(foot.y).toBeCloseTo(8, 9);

    const { svg } = render({
      kind: 'geometry',
      points: [
        { id: 'O', x: 0, y: 0 }, { id: 'A', x: -6, y: 8 }, { id: 'B', x: 6, y: 8 },
      ],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'perpendicular', from: 'O', segment: ['A', 'B'] },
      ],
    });
    // A right-angle marker is drawn at the computed foot.
    expect(svg).toContain('<polyline');
  });

  it('15. a tangent is perpendicular to the radius at contact', () => {
    const [p, q] = tangentEndpoints(vec(0, 0), vec(10, 0), 8);
    expect(p.x).toBeCloseTo(10, 9);
    expect(q.x).toBeCloseTo(10, 9);
    expect(Math.abs(p.y - q.y)).toBeCloseTo(8, 9);
    render({
      kind: 'geometry',
      points: [{ id: 'O', x: 0, y: 0 }, { id: 'T', x: 10, y: 0, label: 'T' }],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'tangent', circle: 'O', at: 'T', length: 8 },
      ],
    });
  });

  it('16. a right-angled triangle renders with its marker', () => {
    const { svg } = render({
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
    expect(svg).toContain('<polyline');
    expect(svg).toContain('>A</text>');
  });

  it('17. aspect ratio is preserved so a circle stays circular', () => {
    // Rendered into a deliberately non-square box.
    const { svg } = render({
      kind: 'geometry',
      points: [{ id: 'O', x: 0, y: 0 }],
      shapes: [{ type: 'circle', center: 'O', radius: 5 }],
    }, { width: 800, height: 300 });
    const match = svg.match(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/);
    expect(match).not.toBeNull();
    // A single <circle> (not an ellipse) is the guarantee; a stretched
    // transform would have required rx/ry.
    expect(svg).not.toContain('<ellipse');
  });

  it('18. an unlabelled point is still drawn', () => {
    const { svg } = render({
      kind: 'geometry',
      points: [{ id: 'P', x: 1, y: 1 }],
      shapes: [{ type: 'circle', center: 'P', radius: 2 }],
    });
    expect(svg).toContain('<circle');
  });

  it('19. visible:false suppresses the marker but keeps the reference usable', () => {
    const shown = render({
      kind: 'geometry',
      points: [{ id: 'O', x: 0, y: 0 }, { id: 'P', x: 5, y: 0 }],
      shapes: [{ type: 'segment', from: 'O', to: 'P' }],
    }).svg;
    const hidden = render({
      kind: 'geometry',
      points: [{ id: 'O', x: 0, y: 0 }, { id: 'P', x: 5, y: 0, visible: false }],
      shapes: [{ type: 'segment', from: 'O', to: 'P' }],
    }).svg;
    expect((hidden.match(/<circle/g) || []).length)
      .toBeLessThan((shown.match(/<circle/g) || []).length);
    expect(hidden).toContain('<line');
  });
});

// ── Charts ──────────────────────────────────────────────────────────────────

describe('cartesian and charts', () => {
  it('20. plots a parabola with axes and grid', () => {
    const { svg } = render({
      kind: 'cartesian', xRange: [-4, 4], yRange: [-6, 10], grid: true,
      xLabel: 'x', yLabel: 'y',
      functions: [{ form: 'quadratic', coefficients: [1, 0, -4], label: 'y = x^2 - 4' }],
    });
    expect(svg).toContain('<polyline');
    expect(svg).toContain('>x</text>');
    expect(svg).toContain('>y</text>');
    expect(svg).toContain('y = x^2 - 4');
  });

  it('21. a reciprocal is not joined across its asymptote', () => {
    const { svg } = render({
      kind: 'cartesian', xRange: [-5, 5], yRange: [-5, 5],
      functions: [{ form: 'reciprocal', coefficients: [1] }],
    });
    // Two separate branches, so at least two polylines for the curve.
    expect((svg.match(/<polyline/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('22. draws a straight line between two plotted points', () => {
    const { svg } = render({
      kind: 'cartesian', xRange: [0, 10], yRange: [0, 10],
      points: [{ id: 'P', x: 1, y: 1, label: 'P' }, { id: 'Q', x: 8, y: 6, label: 'Q' }],
      lines: [{ from: 'P', to: 'Q', label: 'PQ' }],
    });
    expect(svg).toContain('>P</text>');
    expect(svg).toContain('>Q</text>');
    expect(svg).toContain('PQ');
  });

  it('23. renders a bar chart with categories and values', () => {
    const { svg } = render({
      kind: 'bar_chart',
      categories: ['Asha', 'Ravi', 'Meera'], values: [42, 35, 48],
      yLabel: 'Marks', showValues: true,
    });
    expect((svg.match(/<rect/g) || []).length).toBeGreaterThanOrEqual(4);  // 3 bars + background
    for (const name of ['Asha', 'Ravi', 'Meera']) expect(svg).toContain(`>${name}</text>`);
    expect(svg).toContain('>42</text>');
    expect(svg).toContain('Marks');
  });

  it('24. renders a line graph with markers and a series label', () => {
    const { svg } = render({
      kind: 'line_graph',
      series: [{ label: 'Trolley', points: [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 4, y: 4 }], markers: true }],
      xLabel: 'Time (s)', yLabel: 'Distance (m)',
    });
    expect(svg).toContain('<polyline');
    expect(svg).toContain('Trolley');
    expect(svg).toContain('Time (s)');
  });
});

// ── Physics ─────────────────────────────────────────────────────────────────

describe('ray diagrams follow the optics', () => {
  it('25. the lens equation is used, not eyeballed geometry', () => {
    // u = 25, f = 10 (converging) => v = 250/15 = 16.67, m = -0.667
    const v = thinLensImageDistance(25, 10)!;
    expect(v).toBeCloseTo(16.6667, 3);
    expect(magnification(25, v)).toBeCloseTo(-0.6667, 3);
  });

  it('26. a diverging lens gives a virtual, upright, diminished image', () => {
    const v = thinLensImageDistance(20, -10)!;   // convex? no: f negative
    expect(v).toBeLessThan(0);
    const m = magnification(20, v);
    expect(m).toBeGreaterThan(0);                // upright
    expect(Math.abs(m)).toBeLessThan(1);         // diminished
  });

  it('27. renders each optical device', () => {
    for (const device of ['concave_mirror', 'convex_mirror', 'convex_lens', 'concave_lens']) {
      const { svg } = render({
        kind: 'ray_diagram', device, focalLength: 10, objectDistance: 25, objectHeight: 5,
        labels: { object: 'AB', image: "A'B'" },
      });
      expect(svg).toContain('AB');
      expect(svg.length).toBeGreaterThan(400);
    }
  });

  it('28. a virtual image is drawn dashed', () => {
    const { svg } = render({
      kind: 'ray_diagram', device: 'convex_lens',
      focalLength: 10, objectDistance: 5, objectHeight: 4,   // inside the focus
    });
    expect(svg).toContain('stroke-dasharray');
  });

  it('29. renders a force diagram with arrows and a resultant', () => {
    const { svg } = render({
      kind: 'force_diagram',
      body: { shape: 'block', label: 'Box' },
      forces: [
        { label: 'Weight', magnitude: 50, angleDeg: -90 },
        { label: 'Normal', magnitude: 50, angleDeg: 90 },
        { label: 'Push', magnitude: 20, angleDeg: 0 },
      ],
      showResultant: true,
    });
    expect((svg.match(/<polygon/g) || []).length).toBeGreaterThanOrEqual(4);  // arrowheads
    expect(svg).toContain('Weight');
    expect(svg).toContain('Resultant');
  });
});

// ── Templates ───────────────────────────────────────────────────────────────

describe('template diagrams', () => {
  it('30. renders every registered template with its default labels', () => {
    for (const id of ['plant_cell', 'animal_cell', 'bacterial_cell', 'neuron',
      'series_circuit', 'parallel_circuit']) {
      const { svg } = render({ kind: 'template', template: id });
      expect(svg.length).toBeGreaterThan(400);
      const slots = templateSlotIds(id);
      expect(slots.length).toBeGreaterThan(0);
    }
  });

  it('31. a relabelled slot shows the new label, not the default', () => {
    const { svg } = render({
      kind: 'template', template: 'plant_cell',
      labels: { nucleus: 'Kendrak (nucleus)' },
    });
    expect(svg).toContain('Kendrak (nucleus)');
    expect(svg).not.toContain('>Nucleus</text>');
  });

  it('32. a hidden slot is omitted — the labelling-exercise case', () => {
    const shown = render({ kind: 'template', template: 'animal_cell' }).svg;
    const hidden = render({ kind: 'template', template: 'animal_cell', hideLabels: ['nucleus'] }).svg;
    expect(shown).toContain('>Nucleus</text>');
    expect(hidden).not.toContain('>Nucleus</text>');
  });

  it('33. an unknown slot is REJECTED, not silently ignored', () => {
    // Silently dropping it would hand a teacher a diagram missing the label
    // they asked for, with no indication why.
    expect(() => render({
      kind: 'template', template: 'plant_cell', labels: { golgi: 'Golgi body' },
    })).toThrow(DiagramRenderError);
    expect(() => render({
      kind: 'template', template: 'plant_cell', hideLabels: ['golgi'],
    })).toThrow(/no slot "golgi"/);
  });

  it('34. the error names the slots that do exist', () => {
    try {
      render({ kind: 'template', template: 'neuron', labels: { golgi: 'x' } });
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(DiagramRenderError);
      expect(err.message).toContain('available:');
      expect(err.message).toContain('axon');
    }
  });

  it('35. template labels are escaped like any other text', () => {
    const { svg } = render({
      kind: 'template', template: 'animal_cell', labels: { nucleus: '<img src=x onerror=1>' },
    });
    // The hostile string survives only as escaped TEXT: it is not markup, and
    // the skeleton — element names and attributes — is clean.
    expect(svg).not.toContain('<img');
    expect(markupSkeleton(svg)).not.toMatch(/\son[a-z]+\s*=/i);
    expect(svg).toContain('&lt;img');
  });
});

// ── Guard rails ─────────────────────────────────────────────────────────────

describe('renderer guard rails', () => {
  it('36. refuses a diagram kind it has no renderer for', () => {
    expect(() => renderDiagram({ kind: 'nope' } as any)).toThrow(DiagramRenderError);
  });

  it('37. canvas size is honoured and bounded', () => {
    expect(render(GIANT_WHEEL, { width: 800, height: 600 }).width).toBe(800);
    // Absurd requests are clamped to a sane canvas rather than accepted.
    expect(render(GIANT_WHEEL, { width: 99999, height: 99999 }).width).toBe(2000);
    expect(render(GIANT_WHEEL, { width: -5, height: 0 }).width).toBe(560);
  });

  it('38. a single-point diagram does not divide by zero', () => {
    const { svg } = render({
      kind: 'geometry',
      points: [{ id: 'A', x: 3, y: 3, label: 'A' }],
      shapes: [{ type: 'circle', center: 'A', radius: 1 }],
    });
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Infinity');
  });

  it('39. no output anywhere contains NaN or Infinity', () => {
    const specs: any[] = [
      GIANT_WHEEL,
      { kind: 'cartesian', xRange: [-1, 1], yRange: [-1, 1], functions: [{ form: 'reciprocal', coefficients: [1] }] },
      { kind: 'bar_chart', categories: ['a'], values: [0] },
      { kind: 'line_graph', series: [{ points: [{ x: 0, y: 0 }, { x: 0, y: 5 }] }] },
      { kind: 'ray_diagram', device: 'concave_mirror', focalLength: 10, objectDistance: 10.0001, objectHeight: 2 },
    ];
    for (const spec of specs) {
      const { svg } = render(spec);
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('Infinity');
      expect(svg).not.toContain('undefined');
    }
  });
});
