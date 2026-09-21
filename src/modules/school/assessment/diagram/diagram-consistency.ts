/**
 * Geometric consistency — does the construction actually hold?
 *
 * DELIBERATELY SEPARATE FROM THE STRUCTURAL VALIDATOR.
 *
 * `validateDiagramSpec` answers "is this a well-formed specification?": fields
 * present, references resolving, numbers finite, enums recognised. It is the
 * gate in front of the renderer and everything downstream depends on it.
 *
 * This module answers a different question: "is the geometry true?" A chord
 * whose endpoints float off its circle is perfectly well-formed and renders
 * without complaint — it is simply wrong, and wrong in the way that matters
 * most, because it looks like a real diagram. A model asked for a circle of
 * radius 10 with a chord of 12 will cheerfully return endpoints that are
 * neither.
 *
 * The two are kept apart because they fail for different reasons and are acted
 * on differently: a malformed specification is a bug to fix, an inconsistent
 * one is a construction to recompute or reject. Callers run this AFTER
 * validation, on the rebuilt specification.
 *
 * NOTHING IS REPAIRED. No point is moved, no length adjusted. A specification
 * that fails here is reported with the numbers that failed, so a teacher or a
 * calling service can see exactly which relationship is wrong and by how much.
 */
import {
  distance, footOfPerpendicular, midpoint, angleBetween, boundsOf,
  sub, cross, normalize, type Vec, vec,
} from './diagram-geometry';
import type { DiagramSpec, GeometrySpec } from './diagram-spec.types';

export interface ConsistencyResult {
  consistent: boolean;
  /** Relationships that are demonstrably false, with the measured values. */
  errors: string[];
  /**
   * Relationships the schema cannot express enough information to check.
   * Not failures — a caller may surface them, and they document precisely
   * where the guarantee stops.
   */
  unverifiable: string[];
}

/**
 * Length tolerance, as a fraction of the diagram's overall size.
 *
 * Derived from visibility rather than picked: the default canvas is 560px wide
 * with a 34px margin, so the full coordinate span is drawn across roughly
 * 492px. A discrepancy of `e` coordinate units therefore appears as
 * `e * 492 / span` pixels, and two pixels is about the smallest error a reader
 * would notice in printed line art. Setting
 *
 *     tolerance = 2 * span / 492  ~=  0.004 * span
 *
 * makes the rule "reject anything visibly wrong, accept anything that is not".
 *
 * A fixed absolute tolerance would be wrong at both ends: 0.01 units is
 * invisible on a wheel of radius 10 and enormous on a diagram spanning 0.1.
 * Scaling to the diagram is what keeps it meaningful at any scale.
 *
 * Measured on the Giant Wheel at the default canvas, this works out at 1.72px
 * — slightly under the 2px target, because the renderer pads its bounds by 8%
 * and the canvas height constrains a square diagram. Erring tight is the right
 * direction: the cost of rejecting is a clear error message, the cost of
 * accepting is a wrong diagram printed on an exam paper.
 */
export const LENGTH_TOLERANCE_RATIO = 0.004;

/**
 * Angle tolerance, in degrees.
 *
 * Same visibility argument: a 1° error displaces the far end of a 100-pixel
 * arm by about 1.75px, just inside the two-pixel threshold used for lengths.
 * Tighter than this would reject constructions whose coordinates were rounded
 * to two decimals, which is how a human writes them.
 */
export const ANGLE_TOLERANCE_DEG = 1.0;

/** Below this the diagram has no meaningful extent and nothing can be judged. */
const MIN_SCALE = 1e-9;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The diagram's overall size — the diagonal of everything it draws.
 *
 * Circle extents are included, because a specification may declare only a
 * centre point and a radius, and the radius is then the only thing that says
 * how big the picture is.
 */
function diagramScale(spec: GeometrySpec, byId: Map<string, Vec>): number {
  const points = [...byId.values()];
  let bounds = boundsOf(points);
  for (const shape of spec.shapes) {
    if (shape.type !== 'circle') continue;
    const centre = byId.get(shape.center);
    if (!centre) continue;
    bounds = {
      minX: Math.min(bounds.minX, centre.x - shape.radius),
      maxX: Math.max(bounds.maxX, centre.x + shape.radius),
      minY: Math.min(bounds.minY, centre.y - shape.radius),
      maxY: Math.max(bounds.maxY, centre.y + shape.radius),
    };
  }
  return Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

/**
 * Check the geometry of a VALIDATED specification.
 *
 * Non-geometry kinds have no constructions to verify and are reported
 * consistent; their correctness is enforced structurally (a bar chart cannot
 * be geometrically wrong) or computed by the renderer (an optical image
 * position comes from the lens equation, never from the specification).
 */
export function checkGeometricConsistency(spec: DiagramSpec): ConsistencyResult {
  if (!spec || spec.kind !== 'geometry') {
    return { consistent: true, errors: [], unverifiable: [] };
  }

  const errors: string[] = [];
  const unverifiable: string[] = [];
  const byId = new Map<string, Vec>();
  for (const point of spec.points) byId.set(point.id, vec(point.x, point.y));

  const scale = diagramScale(spec, byId);
  if (scale < MIN_SCALE) {
    return {
      consistent: true,
      errors: [],
      unverifiable: ['spec: the diagram has no measurable extent, so no relationship can be checked'],
    };
  }
  const tolerance = LENGTH_TOLERANCE_RATIO * scale;

  // Shapes reference a circle by its CENTRE point id, so two circles sharing a
  // centre make every reference to that centre ambiguous. Radius-dependent
  // checks are skipped for those rather than guessed at.
  const radiiByCentre = new Map<string, number[]>();
  for (const shape of spec.shapes) {
    if (shape.type !== 'circle') continue;
    const list = radiiByCentre.get(shape.center) ?? [];
    list.push(shape.radius);
    radiiByCentre.set(shape.center, list);
  }
  const ambiguousCentres = new Set(
    [...radiiByCentre.entries()].filter(([, radii]) => radii.length > 1).map(([id]) => id),
  );
  for (const centre of ambiguousCentres) {
    unverifiable.push(
      `shapes: point "${centre}" is the centre of more than one circle, so shapes that `
      + 'name it cannot be matched to a single radius; the schema references a circle by '
      + 'its centre, not by the circle\'s own id',
    );
  }

  /** The radius of the circle centred at `id`, or null when ambiguous. */
  const radiusOf = (id: string): number | null => {
    if (ambiguousCentres.has(id)) return null;
    const radii = radiiByCentre.get(id);
    return radii && radii.length === 1 ? radii[0] : null;
  };

  const onCircle = (
    at: string, pointId: string, centreId: string, radius: number, role: string,
  ) => {
    const point = byId.get(pointId)!;
    const centre = byId.get(centreId)!;
    const actual = distance(centre, point);
    if (Math.abs(actual - radius) > tolerance) {
      errors.push(
        `${at}: ${role} "${pointId}" does not lie on the circle centred at "${centreId}" — `
        + `|${centreId}${pointId}| = ${round(actual)}, radius = ${round(radius)} `
        + `(tolerance ${round(tolerance)})`,
      );
      return false;
    }
    return true;
  };

  const distinct = (at: string, aId: string, bId: string, what: string) => {
    const a = byId.get(aId)!;
    const b = byId.get(bId)!;
    if (distance(a, b) <= tolerance) {
      errors.push(
        `${at}: ${what} endpoints "${aId}" and "${bId}" are at the same position, `
        + `so the ${what} has no length`,
      );
      return false;
    }
    return true;
  };

  spec.shapes.forEach((shape, index) => {
    const at = `shapes[${index}]`;

    switch (shape.type) {
      case 'chord': {
        if (!distinct(at, shape.from, shape.to, 'chord')) break;
        const radius = radiusOf(shape.circle);
        if (radius === null) break;
        onCircle(at, shape.from, shape.circle, radius, 'chord endpoint');
        onCircle(at, shape.to, shape.circle, radius, 'chord endpoint');
        break;
      }

      case 'diameter': {
        if (!distinct(at, shape.from, shape.to, 'diameter')) break;
        const radius = radiusOf(shape.circle);
        if (radius === null) break;
        const endsOk = onCircle(at, shape.from, shape.circle, radius, 'diameter endpoint')
          && onCircle(at, shape.to, shape.circle, radius, 'diameter endpoint');
        // A diameter must also pass through the centre, which is exactly the
        // statement that the centre is the midpoint of the two ends. Checking
        // only that both ends lie on the circle would accept any chord.
        const centre = byId.get(shape.circle)!;
        const mid = midpoint(byId.get(shape.from)!, byId.get(shape.to)!);
        const offset = distance(mid, centre);
        if (offset > tolerance) {
          errors.push(
            `${at}: diameter "${shape.from}${shape.to}" does not pass through the centre `
            + `"${shape.circle}" — its midpoint is ${round(offset)} away `
            + `(tolerance ${round(tolerance)}); a diameter's midpoint IS the centre`,
          );
        } else if (endsOk) {
          const span = distance(byId.get(shape.from)!, byId.get(shape.to)!);
          if (Math.abs(span - 2 * radius) > tolerance) {
            errors.push(
              `${at}: diameter "${shape.from}${shape.to}" measures ${round(span)}, `
              + `but twice the radius is ${round(2 * radius)}`,
            );
          }
        }
        break;
      }

      case 'radius': {
        const radius = radiusOf(shape.circle);
        if (radius === null) break;
        onCircle(at, shape.to, shape.circle, radius, 'radius endpoint');
        break;
      }

      case 'tangent': {
        const radius = radiusOf(shape.circle);
        if (radius === null) break;
        // The tangent's DIRECTION is computed by the renderer from the radius,
        // so it cannot be wrong. What can be wrong is the point of contact:
        // a tangent touches the circle, so `at` must lie on it.
        onCircle(at, shape.at, shape.circle, radius, 'point of contact');
        break;
      }

      case 'secant': {
        if (!distinct(at, shape.from, shape.to, 'secant')) break;
        const radius = radiusOf(shape.circle);
        if (radius === null) break;
        // A secant cuts the circle at two points. Requiring its endpoints to
        // lie ON the circle would be wrong — a secant is often drawn from two
        // points outside it — so the real condition is that the LINE passes
        // within the radius of the centre.
        const a = byId.get(shape.from)!;
        const b = byId.get(shape.to)!;
        const centre = byId.get(shape.circle)!;
        const direction = normalize(sub(b, a));
        const offset = Math.abs(cross(direction, sub(centre, a)));
        if (offset >= radius - tolerance) {
          errors.push(
            `${at}: the line "${shape.from}${shape.to}" does not cut the circle centred at `
            + `"${shape.circle}" — it passes ${round(offset)} from the centre, which is not `
            + `less than the radius ${round(radius)}; that is a tangent or a miss, not a secant`,
          );
        }
        break;
      }

      case 'perpendicular': {
        const [aId, bId] = shape.segment;
        const from = byId.get(shape.from)!;
        const a = byId.get(aId)!;
        const b = byId.get(bId)!;
        const computed = footOfPerpendicular(from, a, b);

        if (distance(from, computed) <= tolerance) {
          errors.push(
            `${at}: "${shape.from}" already lies on "${aId}${bId}", so there is no `
            + 'perpendicular to draw from it',
          );
          break;
        }
        // Only a DECLARED foot can be wrong; an omitted one is computed by the
        // renderer and is correct by construction.
        if (!shape.foot) break;
        const declared = byId.get(shape.foot)!;
        const drift = distance(declared, computed);
        if (drift > tolerance) {
          errors.push(
            `${at}: "${shape.foot}" is not the foot of the perpendicular from "${shape.from}" `
            + `to "${aId}${bId}" — it is ${round(drift)} from the true foot `
            + `(${round(computed.x)}, ${round(computed.y)}), tolerance ${round(tolerance)}`,
          );
          break;
        }
        const deg = (angleBetween(declared, from, a) * 180) / Math.PI;
        if (Math.abs(deg - 90) > ANGLE_TOLERANCE_DEG) {
          errors.push(
            `${at}: the angle at "${shape.foot}" measures ${round(deg)}deg, not 90deg `
            + `(tolerance ${ANGLE_TOLERANCE_DEG}deg)`,
          );
        }
        break;
      }

      case 'angle': {
        const vertex = byId.get(shape.at)!;
        const from = byId.get(shape.from)!;
        const to = byId.get(shape.to)!;
        // A ray of zero length has no direction, so the angle is undefined
        // rather than merely hard to draw.
        if (distance(vertex, from) <= tolerance || distance(vertex, to) <= tolerance) {
          errors.push(
            `${at}: the angle at "${shape.at}" has a ray of zero length, so it is undefined`,
          );
          break;
        }
        if (shape.rightAngle) {
          const deg = (angleBetween(vertex, from, to) * 180) / Math.PI;
          if (Math.abs(deg - 90) > ANGLE_TOLERANCE_DEG) {
            errors.push(
              `${at}: marked as a right angle but "${shape.from}${shape.at}${shape.to}" `
              + `measures ${round(deg)}deg (tolerance ${ANGLE_TOLERANCE_DEG}deg)`,
            );
          }
        }
        break;
      }

      case 'polygon': {
        const points = shape.vertices.map((id) => byId.get(id)!);
        // Collinear vertices make a "triangle" that is a line segment. It is
        // structurally valid — three distinct ids — and visually nonsense.
        const height = smallestAltitude(points);
        if (height !== null && height <= tolerance) {
          errors.push(
            `${at}: the vertices ${shape.vertices.map((v) => `"${v}"`).join(', ')} are `
            + `collinear (they deviate by at most ${round(height)}), so this polygon has `
            + 'no area',
          );
        }
        break;
      }

      case 'segment': {
        distinct(at, shape.from, shape.to, 'segment');
        break;
      }

      default:
        break;
    }
  });

  // Measurements are free text with no unit or scale anywhere in the schema,
  // so "12 m" on a chord of 11.4 coordinate units cannot be judged: the
  // diagram may legitimately be drawn to a different scale.
  const measured = spec.shapes.filter((s) => typeof (s as any).measure === 'string').length;
  if (measured > 0) {
    unverifiable.push(
      `shapes: ${measured} measurement label(s) cannot be checked against the drawing — `
      + 'the schema carries no unit or scale, so a label and the coordinates cannot be compared',
    );
  }

  return { consistent: errors.length === 0, errors, unverifiable };
}

/**
 * The smallest distance from any vertex to the line through the two furthest
 * apart. Zero means every vertex is collinear.
 */
function smallestAltitude(points: Vec[]): number | null {
  if (points.length < 3) return null;
  let bestPair: [Vec, Vec] = [points[0], points[1]];
  let longest = -1;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = distance(points[i], points[j]);
      if (d > longest) {
        longest = d;
        bestPair = [points[i], points[j]];
      }
    }
  }
  if (longest <= 0) return 0;
  const [a, b] = bestPair;
  const direction = normalize(sub(b, a));
  let maxOffset = 0;
  for (const p of points) {
    const offset = Math.abs(cross(direction, sub(p, a)));
    if (offset > maxOffset) maxOffset = offset;
  }
  return maxOffset;
}
