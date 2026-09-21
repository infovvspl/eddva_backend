/**
 * Geometric consistency.
 *
 * The failure this exists to catch is specific: a specification that is
 * perfectly well-formed and completely wrong. A chord whose endpoints float
 * off its circle passes every structural check and renders without complaint —
 * it just isn't the construction the question describes. A model asked for a
 * circle of radius 10 with a chord of 12 will return endpoints that are
 * neither, and the result looks like a real diagram.
 *
 * So these tests do two things: prove a correct construction is accepted, and
 * prove that deliberately broken variants of that same construction are
 * rejected with the numbers that made them wrong.
 */
import { validateDiagramSpec } from './diagram-spec.validator';
import {
  checkGeometricConsistency, LENGTH_TOLERANCE_RATIO, ANGLE_TOLERANCE_DEG,
} from './diagram-consistency';
import type { DiagramSpec } from './diagram-spec.types';

/** Structural validation first, exactly as a caller would run it. */
function check(input: any) {
  const validated = validateDiagramSpec(input);
  if (!validated.valid) {
    throw new Error(`fixture failed STRUCTURAL validation: ${validated.errors.join(' | ')}`);
  }
  return checkGeometricConsistency(validated.spec as DiagramSpec);
}

const consistent = (input: any) => {
  const r = check(input);
  if (!r.consistent) throw new Error(`expected consistent, got: ${r.errors.join(' | ')}`);
  return r;
};
const inconsistent = (input: any) => {
  const r = check(input);
  expect(r.consistent).toBe(false);
  expect(r.errors.length).toBeGreaterThan(0);
  return r;
};

/**
 * The Giant Wheel.
 *
 *   radius 10, chord AB = 12  =>  AM = MB = 6,  OM = sqrt(100 - 36) = 8
 *   C is diametrically opposite A, so O is the midpoint of AC
 *   BC is the support cable
 */
const O = { id: 'O', x: 0, y: 0, label: 'O' };
const A = { id: 'A', x: -6, y: 8, label: 'A' };
const B = { id: 'B', x: 6, y: 8, label: 'B' };
const M = { id: 'M', x: 0, y: 8, label: 'M' };
const C = { id: 'C', x: 6, y: -8, label: 'C' };

function giantWheel(overrides: { points?: any[]; shapes?: any[] } = {}) {
  return {
    kind: 'geometry',
    title: 'Giant wheel',
    points: overrides.points ?? [O, A, B, M, C],
    shapes: overrides.shapes ?? [
      { type: 'circle', center: 'O', radius: 10 },
      { type: 'chord', circle: 'O', from: 'A', to: 'B' },
      { type: 'diameter', circle: 'O', from: 'A', to: 'C' },
      { type: 'radius', circle: 'O', to: 'B' },
      { type: 'perpendicular', from: 'O', segment: ['A', 'B'], foot: 'M' },
      { type: 'segment', from: 'B', to: 'C' },
      { type: 'angle', at: 'M', from: 'O', to: 'B', rightAngle: true },
    ],
  };
}

/** Scale of the wheel: the bounding box is 20 x 20, so the diagonal is 20root2. */
const WHEEL_SCALE = Math.hypot(20, 20);
const WHEEL_TOLERANCE = LENGTH_TOLERANCE_RATIO * WHEEL_SCALE;

// ── The Giant Wheel ─────────────────────────────────────────────────────────

describe('the Giant Wheel construction', () => {
  it('1. the fixture is arithmetically the stated problem', () => {
    // Guards the tests below: if this drifts, everything after it is checking
    // a construction that is not the question.
    expect(Math.hypot(A.x - O.x, A.y - O.y)).toBeCloseTo(10, 9);
    expect(Math.hypot(B.x - O.x, B.y - O.y)).toBeCloseTo(10, 9);
    expect(Math.hypot(C.x - O.x, C.y - O.y)).toBeCloseTo(10, 9);
    expect(Math.hypot(B.x - A.x, B.y - A.y)).toBeCloseTo(12, 9);   // chord AB
    expect(Math.hypot(M.x - A.x, M.y - A.y)).toBeCloseTo(6, 9);    // AM
    expect(Math.hypot(M.x - B.x, M.y - B.y)).toBeCloseTo(6, 9);    // MB
    expect(Math.hypot(M.x - O.x, M.y - O.y)).toBeCloseTo(8, 9);    // OM
    // O is the midpoint of AC, i.e. C is diametrically opposite A.
    expect((A.x + C.x) / 2).toBeCloseTo(O.x, 9);
    expect((A.y + C.y) / 2).toBeCloseTo(O.y, 9);
  });

  it('2. the whole construction is accepted', () => {
    const r = consistent(giantWheel());
    expect(r.errors).toEqual([]);
  });

  it('3. a chord endpoint moved off the circle is rejected, with the measurement', () => {
    const r = inconsistent(giantWheel({ points: [O, { ...A, y: 9 }, B, M, C] }));
    const joined = r.errors.join(' | ');
    expect(joined).toContain('chord endpoint "A" does not lie on the circle');
    expect(joined).toContain('radius = 10');
    expect(joined).toMatch(/shapes\[\d+\]/);
  });

  it('4. C not diametrically opposite A is rejected even though it is ON the circle', () => {
    // (8, -6) is still exactly 10 from O — both endpoints lie on the circle —
    // but AC no longer passes through the centre, so it is a chord, not a
    // diameter. Checking only "endpoints on the circle" would accept this.
    const moved = { id: 'C', x: 8, y: -6, label: 'C' };
    expect(Math.hypot(moved.x, moved.y)).toBeCloseTo(10, 9);
    const r = inconsistent(giantWheel({ points: [O, A, B, M, moved] }));
    expect(r.errors.join(' | ')).toContain('does not pass through the centre');
  });

  it('5. a wrong foot for OM is rejected and the true foot is reported', () => {
    const r = inconsistent(giantWheel({ points: [O, A, B, { id: 'M', x: 3, y: 8, label: 'M' }, C] }));
    const joined = r.errors.join(' | ');
    expect(joined).toContain('is not the foot of the perpendicular');
    expect(joined).toContain('(0, 8)');
  });

  it('6. a right-angle marker on an angle that is not right is rejected', () => {
    // Keep M on AB so the perpendicular check passes, and mark a different,
    // genuinely non-right angle instead.
    const r = inconsistent(giantWheel({
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'chord', circle: 'O', from: 'A', to: 'B' },
        { type: 'angle', at: 'O', from: 'A', to: 'B', rightAngle: true },
      ],
    }));
    expect(r.errors.join(' | ')).toContain('marked as a right angle');
  });

  it('7. every measurement label is reported as unverifiable, not as an error', () => {
    const r = consistent(giantWheel({
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'chord', circle: 'O', from: 'A', to: 'B', measure: '12 m' },
        { type: 'radius', circle: 'O', to: 'B', measure: '10 m' },
      ],
    }));
    expect(r.consistent).toBe(true);
    expect(r.unverifiable.join(' ')).toContain('no unit or scale');
    expect(r.unverifiable.join(' ')).toContain('2 measurement label');
  });
});

// ── Circle relationships ────────────────────────────────────────────────────

describe('chord, diameter, radius and tangent', () => {
  const base = (shapes: any[], points: any[] = [O, A, B, C, { id: 'T', x: 10, y: 0 }]) =>
    ({ kind: 'geometry', points, shapes: [{ type: 'circle', center: 'O', radius: 10 }, ...shapes] });

  it('8. a correct chord is accepted', () => {
    consistent(base([{ type: 'chord', circle: 'O', from: 'A', to: 'B' }]));
  });

  it('9. both chord endpoints are checked, not just the first', () => {
    const r = inconsistent(base(
      [{ type: 'chord', circle: 'O', from: 'A', to: 'B' }],
      [O, A, { id: 'B', x: 6, y: 5 }, C, { id: 'T', x: 10, y: 0 }],
    ));
    expect(r.errors.join(' ')).toContain('"B"');
  });

  it('10. a zero-length chord is rejected', () => {
    const r = inconsistent(base(
      [{ type: 'chord', circle: 'O', from: 'A', to: 'B' }],
      [O, A, { id: 'B', x: -6, y: 8 }, C, { id: 'T', x: 10, y: 0 }],
    ));
    expect(r.errors.join(' ')).toContain('same position');
  });

  it('11. a radius endpoint off the circle is rejected', () => {
    consistent(base([{ type: 'radius', circle: 'O', to: 'B' }]));
    const r = inconsistent(base(
      [{ type: 'radius', circle: 'O', to: 'B' }],
      [O, A, { id: 'B', x: 0, y: 7 }, C, { id: 'T', x: 10, y: 0 }],
    ));
    expect(r.errors.join(' ')).toContain('radius endpoint "B"');
  });

  it('12. a diameter of the wrong length is rejected', () => {
    // Endpoints on the circle and the centre as midpoint, but a radius that
    // disagrees: only possible if the circle's radius is not what it claims.
    const r = inconsistent({
      kind: 'geometry',
      points: [O, { id: 'P', x: -6, y: 0 }, { id: 'Q', x: 6, y: 0 }],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'diameter', circle: 'O', from: 'P', to: 'Q' },
      ],
    });
    expect(r.errors.join(' ')).toContain('does not lie on the circle');
  });

  it('13. a tangent must touch the circle', () => {
    consistent(base([{ type: 'tangent', circle: 'O', at: 'T', length: 8 }]));
    const r = inconsistent(base(
      [{ type: 'tangent', circle: 'O', at: 'T', length: 8 }],
      [O, A, B, C, { id: 'T', x: 12, y: 0 }],
    ));
    expect(r.errors.join(' ')).toContain('point of contact "T"');
  });

  it('14. a secant must actually cut the circle', () => {
    // A line 4 from the centre cuts a circle of radius 10.
    consistent({
      kind: 'geometry',
      points: [O, { id: 'P', x: -20, y: 4 }, { id: 'Q', x: 20, y: 4 }],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'secant', circle: 'O', from: 'P', to: 'Q' },
      ],
    });
    // A line 14 from the centre misses it entirely.
    const r = inconsistent({
      kind: 'geometry',
      points: [O, { id: 'P', x: -20, y: 14 }, { id: 'Q', x: 20, y: 14 }],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'secant', circle: 'O', from: 'P', to: 'Q' },
      ],
    });
    expect(r.errors.join(' ')).toContain('does not cut the circle');
  });
});

// ── Perpendiculars, angles, polygons ────────────────────────────────────────

describe('perpendiculars and angles', () => {
  it('15. a correct perpendicular with a declared foot is accepted', () => {
    consistent({
      kind: 'geometry',
      points: [O, A, B, M],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'perpendicular', from: 'O', segment: ['A', 'B'], foot: 'M' },
      ],
    });
  });

  it('16. an omitted foot is not an error — the renderer computes it', () => {
    const r = consistent({
      kind: 'geometry',
      points: [O, A, B],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'perpendicular', from: 'O', segment: ['A', 'B'] },
      ],
    });
    expect(r.errors).toEqual([]);
  });

  it('17. a perpendicular from a point already on the line is rejected', () => {
    const r = inconsistent({
      kind: 'geometry',
      points: [O, A, B, M],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'perpendicular', from: 'M', segment: ['A', 'B'] },
      ],
    });
    expect(r.errors.join(' ')).toContain('no perpendicular to draw');
  });

  it('18. a genuine right angle is accepted', () => {
    consistent({
      kind: 'geometry',
      points: [
        { id: 'P', x: 0, y: 0 }, { id: 'Q', x: 3, y: 0 }, { id: 'R', x: 3, y: 4 },
      ],
      shapes: [
        { type: 'polygon', vertices: ['P', 'Q', 'R'] },
        { type: 'angle', at: 'Q', from: 'P', to: 'R', rightAngle: true },
      ],
    });
  });

  it('19. an angle with a zero-length ray is undefined, not merely awkward', () => {
    const r = inconsistent({
      kind: 'geometry',
      points: [
        { id: 'P', x: 0, y: 0 }, { id: 'Q', x: 0, y: 0 }, { id: 'R', x: 3, y: 4 },
      ],
      shapes: [
        { type: 'circle', center: 'P', radius: 5 },
        { type: 'angle', at: 'P', from: 'Q', to: 'R' },
      ],
    });
    expect(r.errors.join(' ')).toContain('zero length');
  });

  it('20. a non-right angle without the marker is fine', () => {
    consistent({
      kind: 'geometry',
      points: [
        { id: 'P', x: 0, y: 0 }, { id: 'Q', x: 5, y: 0 }, { id: 'R', x: 4, y: 3 },
      ],
      shapes: [
        { type: 'polygon', vertices: ['P', 'Q', 'R'] },
        { type: 'angle', at: 'P', from: 'Q', to: 'R', label: 'theta' },
      ],
    });
  });

  it('21. a collinear "triangle" is rejected', () => {
    const r = inconsistent({
      kind: 'geometry',
      points: [
        { id: 'P', x: 0, y: 0 }, { id: 'Q', x: 5, y: 5 }, { id: 'R', x: 10, y: 10 },
      ],
      shapes: [{ type: 'polygon', vertices: ['P', 'Q', 'R'] }],
    });
    expect(r.errors.join(' ')).toContain('collinear');
  });
});

// ── Tolerance behaviour ─────────────────────────────────────────────────────

describe('tolerance', () => {
  /** A wheel whose point A sits `off` further from the centre than the radius. */
  const wheelWithDrift = (off: number) => giantWheel({
    points: [O, { id: 'A', x: -6, y: 8 + off * 1.25 }, B, M, C],
    shapes: [
      { type: 'circle', center: 'O', radius: 10 },
      { type: 'chord', circle: 'O', from: 'A', to: 'B' },
    ],
  });

  it('22. accepts an error well inside the tolerance', () => {
    // Coordinates rounded to two decimals must not be rejected.
    consistent(wheelWithDrift(WHEEL_TOLERANCE * 0.2));
  });

  it('23. rejects an error well outside the tolerance', () => {
    inconsistent(wheelWithDrift(WHEEL_TOLERANCE * 5));
  });

  it('24. the tolerance scales with the diagram, not with absolute units', () => {
    // The same construction at 1/100 scale must behave identically: a fixed
    // absolute tolerance would accept a grossly wrong small diagram.
    const tiny = {
      kind: 'geometry',
      points: [
        { id: 'O', x: 0, y: 0 }, { id: 'A', x: -0.06, y: 0.08 }, { id: 'B', x: 0.06, y: 0.08 },
      ],
      shapes: [
        { type: 'circle', center: 'O', radius: 0.1 },
        { type: 'chord', circle: 'O', from: 'A', to: 'B' },
      ],
    };
    consistent(tiny);

    const tinyBroken = JSON.parse(JSON.stringify(tiny));
    tinyBroken.points[1].y = 0.09;      // proportionally the same error as test 3
    inconsistent(tinyBroken);
  });

  it('25. the tolerance constants are documented and visibility-derived', () => {
    // 0.004 of the diagram span is about two pixels on the default canvas.
    expect(LENGTH_TOLERANCE_RATIO).toBeCloseTo(0.004, 6);
    expect(ANGLE_TOLERANCE_DEG).toBe(1.0);
  });

  it('26. an angle just inside and just outside the angle tolerance', () => {
    // A right angle tilted by an angle either side of ANGLE_TOLERANCE_DEG.
    const tilted = (deg: number) => {
      const rad = ((90 + deg) * Math.PI) / 180;
      return {
        kind: 'geometry',
        points: [
          { id: 'P', x: 0, y: 0 },
          { id: 'Q', x: 10, y: 0 },
          { id: 'R', x: 10 * Math.cos(rad), y: 10 * Math.sin(rad) },
        ],
        shapes: [
          { type: 'circle', center: 'P', radius: 10 },
          { type: 'angle', at: 'P', from: 'Q', to: 'R', rightAngle: true },
        ],
      };
    };
    consistent(tilted(ANGLE_TOLERANCE_DEG * 0.5));
    inconsistent(tilted(ANGLE_TOLERANCE_DEG * 3));
  });
});

// ── Separation of concerns, and the limits of what can be checked ───────────

describe('scope and limitations', () => {
  it('27. structural and geometric validation stay separate', () => {
    // A structurally invalid spec never reaches the consistency checker; it is
    // the validator's job to reject it, with its own errors.
    const structurallyBad = validateDiagramSpec({
      kind: 'geometry',
      points: [{ id: 'A', x: 0, y: 0 }],
      shapes: [{ type: 'chord', circle: 'Z', from: 'A', to: 'A' }],
    });
    expect(structurallyBad.valid).toBe(false);
    expect(structurallyBad.errors.join(' ')).toContain('unknown point "Z"');
  });

  it('28. nothing is repaired — the returned spec is untouched', () => {
    const input = giantWheel({ points: [O, { ...A, y: 9 }, B, M, C] });
    const validated = validateDiagramSpec(input);
    const before = JSON.stringify(validated.spec);
    checkGeometricConsistency(validated.spec as DiagramSpec);
    expect(JSON.stringify(validated.spec)).toBe(before);
    // and in particular A was not moved back onto the circle
    expect((validated.spec as any).points[1].y).toBe(9);
  });

  it('29. two circles sharing a centre are reported unverifiable, not wrong', () => {
    // The schema references a circle by its CENTRE, so a shape naming "O"
    // cannot be matched to one of two radii. Guessing would be worse than
    // saying so.
    const r = check({
      kind: 'geometry',
      points: [O, A, B],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'circle', center: 'O', radius: 5 },
        { type: 'chord', circle: 'O', from: 'A', to: 'B' },
      ],
    });
    expect(r.unverifiable.join(' ')).toContain('more than one circle');
    // A and B lie on the radius-10 circle but not the radius-5 one, so the
    // checker must decline rather than pick one and report a false error.
    expect(r.consistent).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('30. non-geometry kinds have nothing to verify', () => {
    for (const spec of [
      { kind: 'bar_chart', categories: ['a'], values: [1] },
      { kind: 'cartesian', xRange: [-1, 1], yRange: [-1, 1] },
      { kind: 'ray_diagram', device: 'convex_lens', focalLength: 5, objectDistance: 20, objectHeight: 3 },
      { kind: 'template', template: 'neuron' },
    ]) {
      const r = check(spec);
      expect(r.consistent).toBe(true);
      expect(r.errors).toEqual([]);
    }
  });

  it('31. a degenerate diagram reports that nothing could be measured', () => {
    const r = checkGeometricConsistency({
      kind: 'geometry',
      points: [{ id: 'A', x: 5, y: 5 }],
      shapes: [{ type: 'circle', center: 'A', radius: 0 }],
    } as any);
    expect(r.consistent).toBe(true);
    expect(r.unverifiable.join(' ')).toContain('no measurable extent');
  });

  it('32. every error names a field path and the measured values', () => {
    const r = inconsistent(giantWheel({ points: [O, { ...A, y: 9 }, B, M, C] }));
    for (const message of r.errors) {
      expect(message).toMatch(/^shapes\[\d+\]: /);
    }
    expect(r.errors.join(' ')).toMatch(/\d/);
  });
});

// ── Regression ──────────────────────────────────────────────────────────────

describe('regression — existing valid specifications', () => {
  it('33. the Phase 3 render fixtures all remain consistent', () => {
    // These are the specifications the renderer tests draw. If a consistency
    // rule ever rejects one of them, the rule is wrong, not the fixture.
    consistent(giantWheel());
    consistent({
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
    consistent({
      kind: 'geometry',
      points: [
        { id: 'O', x: 0, y: 0 }, { id: 'A', x: -6, y: 8 }, { id: 'B', x: 6, y: 8 },
        { id: 'C', x: 6, y: -8 }, { id: 'M', x: 0, y: 8 }, { id: 'T', x: 10, y: 0 },
      ],
      shapes: [
        { type: 'circle', center: 'O', radius: 10 },
        { type: 'chord', circle: 'O', from: 'A', to: 'B' },
        { type: 'diameter', circle: 'O', from: 'A', to: 'C' },
        { type: 'radius', circle: 'O', to: 'B' },
        { type: 'tangent', circle: 'O', at: 'T', length: 6 },
        { type: 'perpendicular', from: 'O', segment: ['A', 'B'], foot: 'M' },
        { type: 'angle', at: 'M', from: 'O', to: 'B', rightAngle: true },
        { type: 'segment', from: 'B', to: 'C' },
        { type: 'polygon', vertices: ['A', 'B', 'C'] },
      ],
    });
  });

  it('34. a simple point-and-circle spec is unaffected', () => {
    consistent({
      kind: 'geometry',
      points: [{ id: 'P', x: 1, y: 1 }],
      shapes: [{ type: 'circle', center: 'P', radius: 2 }],
    });
  });
});
