/**
 * Plane geometry used by the renderers.
 *
 * Pure functions on plain {x, y} pairs, in the specification's own coordinate
 * space — y increases UPWARD here, as it does in mathematics. Converting to the
 * screen's downward y is the layout module's job and happens exactly once, so
 * nothing in this file has to reason about a flipped axis.
 *
 * Kept separate from rendering so the arithmetic can be tested as arithmetic.
 */

export interface Vec {
  x: number;
  y: number;
}

export function vec(x: number, y: number): Vec {
  return { x, y };
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec, k: number): Vec {
  return { x: a.x * k, y: a.y * k };
}

export function length(a: Vec): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Unit vector, or (0,0) for a degenerate input rather than NaN. */
export function normalize(a: Vec): Vec {
  const len = length(a);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Rotate 90° anticlockwise. */
export function perpendicular(a: Vec): Vec {
  return { x: -a.y, y: a.x };
}

export function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec, b: Vec): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * The foot of the perpendicular from `p` onto the infinite line through a, b.
 *
 * Returns `a` when the segment is degenerate, so a malformed construction
 * degrades to a visible point rather than NaN coordinates that would silently
 * blank the diagram.
 */
export function footOfPerpendicular(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const denominator = dot(ab, ab);
  if (denominator === 0) return { ...a };
  const t = dot(sub(p, a), ab) / denominator;
  return add(a, scale(ab, t));
}

/** Angle of a vector in radians, measured anticlockwise from +x. */
export function angleOf(a: Vec): number {
  return Math.atan2(a.y, a.x);
}

/** Non-reflex angle at `vertex` between the rays to `from` and `to`, in radians. */
export function angleBetween(vertex: Vec, from: Vec, to: Vec): number {
  const u = normalize(sub(from, vertex));
  const v = normalize(sub(to, vertex));
  const cosine = Math.min(1, Math.max(-1, dot(u, v)));
  return Math.acos(cosine);
}

/** True when the angle at `vertex` is a right angle, within tolerance. */
export function isRightAngle(vertex: Vec, from: Vec, to: Vec, toleranceDeg = 0.5): boolean {
  const deg = (angleBetween(vertex, from, to) * 180) / Math.PI;
  return Math.abs(deg - 90) <= toleranceDeg;
}

/**
 * The two points where the tangent at `touch` reaches, `len` either side.
 *
 * The tangent to a circle is perpendicular to the radius at the point of
 * contact, so it is derived from the centre rather than taken on trust.
 */
export function tangentEndpoints(centre: Vec, touch: Vec, len: number): [Vec, Vec] {
  const radial = normalize(sub(touch, centre));
  // A point at the centre has no defined tangent direction; fall back to
  // horizontal so the shape is visible and obviously wrong rather than absent.
  const direction = length(radial) === 0 ? vec(1, 0) : perpendicular(radial);
  return [
    add(touch, scale(direction, len / 2)),
    add(touch, scale(direction, -len / 2)),
  ];
}

/**
 * Extend a segment past both ends by `amount` — the "produce the line" of a
 * school construction, used for secants and extended straight-line graphs.
 */
export function extendSegment(a: Vec, b: Vec, amount: number): [Vec, Vec] {
  const direction = normalize(sub(b, a));
  if (length(direction) === 0) return [{ ...a }, { ...b }];
  return [add(a, scale(direction, -amount)), add(b, scale(direction, amount))];
}

/**
 * Sweep for an angle arc at `vertex`, from the ray to `from` to the ray to
 * `to`, taking the non-reflex side.
 */
export function arcAngles(vertex: Vec, from: Vec, to: Vec): { start: number; end: number } {
  const start = angleOf(sub(from, vertex));
  const end = angleOf(sub(to, vertex));
  let delta = end - start;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  return { start, end: start + delta };
}

/** A point on a circle at a given angle. */
export function pointOnCircle(centre: Vec, radius: number, angle: number): Vec {
  return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
}

/**
 * Image distance from the mirror/lens equation, with the real-is-positive
 * convention used in Indian school textbooks.
 *
 *   1/v = 1/f - 1/u     (converging: f > 0; diverging: f < 0)
 *
 * `u` is the object distance, always given as a positive magnitude, and `f` is
 * signed by the caller according to the device. Returns null when the rays
 * emerge parallel and no image forms.
 */
export function thinLensImageDistance(objectDistance: number, signedFocal: number): number | null {
  const denominator = objectDistance - signedFocal;
  if (Math.abs(denominator) < 1e-9) return null;
  return (objectDistance * signedFocal) / denominator;
}

/** Linear magnification m = -v/u, i.e. image height = m x object height. */
export function magnification(objectDistance: number, imageDistance: number): number {
  if (objectDistance === 0) return 0;
  return -imageDistance / objectDistance;
}

/** Axis-aligned bounds of a set of points, expanded by per-point radii. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Vec[], fallback: Bounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 }): Bounds {
  if (!points.length) return { ...fallback };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { ...fallback };
  return { minX, minY, maxX, maxY };
}

export function expandBounds(bounds: Bounds, by: number): Bounds {
  return {
    minX: bounds.minX - by,
    minY: bounds.minY - by,
    maxX: bounds.maxX + by,
    maxY: bounds.maxY + by,
  };
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
