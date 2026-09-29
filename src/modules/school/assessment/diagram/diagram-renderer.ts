/**
 * Deterministic SVG rendering.
 *
 * Takes a specification that has already passed the Phase 2 validator and
 * produces markup. It never parses, never evaluates and never embeds anything
 * the caller supplied except escaped text.
 *
 * DETERMINISM
 * The same validated specification and the same RENDERER_VERSION produce
 * byte-identical output. Nothing here reads the clock, a locale, a random
 * source or the environment; arrays are walked in their given order; numbers
 * go through `fmt`, which rounds to a fixed precision and normalises -0. That
 * property is what allows the storage key to be a hash of the specification.
 *
 * CORRECTNESS OVER OBEDIENCE
 * Where a construction is determined by mathematics, the renderer computes it
 * rather than trusting coordinates: the foot of a perpendicular, a tangent's
 * direction, the position of an optical image. A model that places a tangent
 * by eye produces a drawing that is subtly wrong, and a subtly wrong diagram on
 * an exam paper is the failure worth the most effort to avoid.
 *
 * Deriving a whole construction from constraints — and verifying one that was
 * supplied — is Phase 4. This phase renders what it is given, correctly.
 */
import {
  DIAGRAM_TEMPLATES,
  type TemplateSlot,
} from './diagram-templates';
import {
  arcAngles, boundsOf, distance, expandBounds, extendSegment, footOfPerpendicular,
  magnification, midpoint, normalize, perpendicular, pointOnCircle, scale as vscale,
  sub, tangentEndpoints, thinLensImageDistance, unionBounds, vec,
  type Bounds, type Vec,
} from './diagram-geometry';
import {
  createTransform, DEFAULT_CANVAS, outwardPosition, placeLabel,
  type CanvasOptions, type Transform,
} from './diagram-layout';
import {
  arrowHead, assertSafeSvg, circle, dashArray, fmt, group, line, path, polyline,
  rect, svgDocument, text, type Attrs,
} from './svg-primitives';
import {
  RENDERER_VERSION,
  type BarChartSpec, type CartesianSpec, type DiagramSpec, type ForceDiagramSpec,
  type GeometrySpec, type LineGraphSpec, type RayDiagramSpec, type SpecPoint,
  type StrokeStyle, type TemplateSpec,
} from './diagram-spec.types';

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  rendererVersion: string;
}

export class DiagramRenderError extends Error {}

const INK = 'currentColor';

function strokeAttrs(style?: StrokeStyle, extra: Attrs = {}): Attrs {
  const dash = dashArray(style);
  return { stroke: INK, ...(dash ? { 'stroke-dasharray': dash } : {}), ...extra };
}

/** A label drawn at a screen position, already escaped by `text`. */
function labelAt(p: Vec, content: string, position: any, offset = 9, extra: Attrs = {}): string {
  const place = placeLabel(position, offset);
  return text(p.x + place.dx, p.y + place.dy, content, {
    'text-anchor': place.anchor,
    'dominant-baseline': place.baseline,
    fill: INK,
    stroke: 'none',
    ...extra,
  });
}

function title(t: string | undefined, width: number): string {
  if (!t) return '';
  return text(width / 2, 20, t, {
    'text-anchor': 'middle', fill: INK, stroke: 'none',
    'font-size': 14, 'font-weight': 'bold',
  });
}

// ── Geometry ────────────────────────────────────────────────────────────────

function geometryBounds(spec: GeometrySpec, byId: Map<string, Vec>): Bounds {
  let bounds = boundsOf([...byId.values()]);
  for (const shape of spec.shapes) {
    if (shape.type === 'circle') {
      const centre = byId.get(shape.center);
      if (!centre) continue;
      bounds = unionBounds(bounds, {
        minX: centre.x - shape.radius, maxX: centre.x + shape.radius,
        minY: centre.y - shape.radius, maxY: centre.y + shape.radius,
      });
    }
    if (shape.type === 'tangent') {
      const centre = byId.get(shape.circle);
      const touch = byId.get(shape.at);
      if (!centre || !touch) continue;
      const [a, b] = tangentEndpoints(centre, touch, shape.length);
      bounds = unionBounds(bounds, boundsOf([a, b]));
    }
  }
  // A little air so labels at the extremes are not flush with the edge.
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-9);
  return expandBounds(bounds, span * 0.08);
}

function rightAngleMarker(t: Transform, vertex: Vec, towardA: Vec, towardB: Vec): string {
  const size = Math.min(12, t.scale * 0.5) || 10;
  const u = normalize(sub(t.toScreen(towardA), t.toScreen(vertex)));
  const v = normalize(sub(t.toScreen(towardB), t.toScreen(vertex)));
  const origin = t.toScreen(vertex);
  const p1 = { x: origin.x + u.x * size, y: origin.y + u.y * size };
  const p3 = { x: origin.x + v.x * size, y: origin.y + v.y * size };
  const p2 = { x: p1.x + v.x * size, y: p1.y + v.y * size };
  return polyline([[p1.x, p1.y], [p2.x, p2.y], [p3.x, p3.y]], { stroke: INK, 'stroke-width': 1.3 });
}

function angleArc(t: Transform, vertex: Vec, from: Vec, to: Vec, radiusPx: number): string {
  const { start, end } = arcAngles(vertex, from, to);
  // Sampled rather than emitted as an elliptical arc command: the sweep flags
  // depend on the y-flip, and sampling gets the visible side right without
  // that reasoning. 24 segments is smooth at print size.
  const steps = 24;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = start + ((end - start) * i) / steps;
    const world = pointOnCircle(vertex, radiusPx / t.scale, angle);
    const screen = t.toScreen(world);
    pts.push([screen.x, screen.y]);
  }
  return polyline(pts, { stroke: INK, 'stroke-width': 1.3 });
}

function renderGeometry(spec: GeometrySpec, options: CanvasOptions): RenderResult {
  const byId = new Map<string, Vec>();
  for (const p of spec.points) byId.set(p.id, vec(p.x, p.y));

  const t = createTransform(geometryBounds(spec, byId), options);
  const body: string[] = [];
  const centroid = averagePoint([...byId.values()]);

  // Shapes first, so point markers and labels sit on top of the lines.
  for (const shape of spec.shapes) {
    switch (shape.type) {
      case 'circle': {
        const centre = byId.get(shape.center)!;
        const c = t.toScreen(centre);
        body.push(circle(c.x, c.y, t.toScreenLength(shape.radius), strokeAttrs(shape.style, { fill: 'none' })));
        break;
      }
      case 'segment':
      case 'chord':
      case 'diameter':
      case 'secant': {
        const from = byId.get((shape as any).from)!;
        const to = byId.get((shape as any).to)!;
        // A secant is a chord produced beyond the circle in both directions.
        const [a, b] = shape.type === 'secant'
          ? extendSegment(from, to, distance(from, to) * 0.35)
          : [from, to];
        const sa = t.toScreen(a);
        const sb = t.toScreen(b);
        body.push(line(sa.x, sa.y, sb.x, sb.y, strokeAttrs(shape.style)));
        if ((shape as any).arrow && (shape as any).arrow !== 'none') {
          const d = sub(sb, sa);
          body.push(arrowHead(sb.x, sb.y, d.x, d.y, 9));
          if ((shape as any).arrow === 'both') {
            body.push(arrowHead(sa.x, sa.y, -d.x, -d.y, 9));
          }
        }
        const measure = (shape as any).measure;
        if (measure) body.push(measureLabel(t, from, to, measure, centroid));
        break;
      }
      case 'radius': {
        const centre = byId.get(shape.circle)!;
        const to = byId.get(shape.to)!;
        const sa = t.toScreen(centre);
        const sb = t.toScreen(to);
        body.push(line(sa.x, sa.y, sb.x, sb.y, strokeAttrs(shape.style)));
        if (shape.measure) body.push(measureLabel(t, centre, to, shape.measure, centroid));
        break;
      }
      case 'tangent': {
        const centre = byId.get(shape.circle)!;
        const touch = byId.get(shape.at)!;
        // Derived from the radius, never taken on trust: a tangent is
        // perpendicular to the radius at the point of contact.
        const [a, b] = tangentEndpoints(centre, touch, shape.length);
        const sa = t.toScreen(a);
        const sb = t.toScreen(b);
        body.push(line(sa.x, sa.y, sb.x, sb.y, strokeAttrs(shape.style)));
        break;
      }
      case 'polygon': {
        const pts = shape.vertices.map((id) => {
          const p = t.toScreen(byId.get(id)!);
          return [p.x, p.y] as [number, number];
        });
        body.push(polyline([...pts, pts[0]], strokeAttrs(shape.style, { fill: 'none' })));
        break;
      }
      case 'perpendicular': {
        const from = byId.get(shape.from)!;
        const [a, b] = shape.segment.map((id) => byId.get(id)!);
        // Computed, not supplied — this is the whole point of the shape.
        const foot = shape.foot ? byId.get(shape.foot)! : footOfPerpendicular(from, a, b);
        const sFrom = t.toScreen(from);
        const sFoot = t.toScreen(foot);
        body.push(line(sFrom.x, sFrom.y, sFoot.x, sFoot.y, strokeAttrs(shape.style)));
        body.push(rightAngleMarker(t, foot, from, a));
        break;
      }
      case 'angle': {
        const vertex = byId.get(shape.at)!;
        const from = byId.get(shape.from)!;
        const to = byId.get(shape.to)!;
        if (shape.rightAngle) {
          body.push(rightAngleMarker(t, vertex, from, to));
        } else {
          body.push(angleArc(t, vertex, from, to, 22));
        }
        if (shape.label) {
          const bisector = normalize({
            x: normalize(sub(from, vertex)).x + normalize(sub(to, vertex)).x,
            y: normalize(sub(from, vertex)).y + normalize(sub(to, vertex)).y,
          });
          const at = t.toScreen({ x: vertex.x + (bisector.x * 34) / t.scale, y: vertex.y + (bisector.y * 34) / t.scale });
          body.push(text(at.x, at.y, shape.label, {
            'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: INK, stroke: 'none', 'font-size': 12,
          }));
        }
        break;
      }
      default:
        break;
    }
  }

  // Points and their labels.
  for (const p of spec.points) {
    if (p.visible === false) continue;
    const screen = t.toScreen(vec(p.x, p.y));
    body.push(circle(screen.x, screen.y, 3, { fill: INK, stroke: 'none' }));
    if (p.label) {
      const position = p.labelPosition ?? outwardPosition(vec(p.x, p.y), centroid);
      body.push(labelAt(screen, p.label, position, 11));
    }
  }

  for (const note of spec.annotations ?? []) {
    const anchors = note.anchor.map((id) => byId.get(id)).filter(Boolean) as Vec[];
    if (!anchors.length) continue;
    const at = anchors.length === 2 ? midpoint(anchors[0], anchors[1]) : anchors[0];
    body.push(labelAt(t.toScreen(at), note.text, note.position ?? 'above', 12, { 'font-size': 12 }));
  }

  return finish(spec.title, t, body);
}

/**
 * A measurement printed beside the midpoint of a segment.
 *
 * Offset perpendicular to the segment and, when a reference point is given,
 * on the side AWAY from it. The midpoint of a chord is exactly where a
 * construction usually puts a labelled point (the foot of a perpendicular,
 * say), so a measurement centred there lands on top of that label.
 */
function measureLabel(t: Transform, a: Vec, b: Vec, content: string, away?: Vec): string {
  const mid = t.toScreen(midpoint(a, b));
  const direction = normalize(sub(t.toScreen(b), t.toScreen(a)));
  let off = perpendicular(direction);
  if (away) {
    const reference = t.toScreen(away);
    // Flip to whichever side points away from the reference.
    if ((mid.x + off.x - reference.x) ** 2 + (mid.y + off.y - reference.y) ** 2
        < (mid.x - off.x - reference.x) ** 2 + (mid.y - off.y - reference.y) ** 2) {
      off = { x: -off.x, y: -off.y };
    }
  }
  // Also shifted ALONG the segment, not only across it. The midpoint of a
  // chord is precisely where a construction puts its labelled point — M, the
  // foot of the perpendicular — so a measurement centred there lands on that
  // label however far it is offset sideways.
  const along = distance(t.toScreen(a), t.toScreen(b)) * 0.24;
  const at = {
    x: mid.x + off.x * 14 + direction.x * along,
    y: mid.y + off.y * 14 + direction.y * along,
  };
  return text(at.x, at.y, content, {
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
    fill: INK, stroke: 'none', 'font-size': 12,
  });
}

function averagePoint(points: Vec[]): Vec {
  if (!points.length) return vec(0, 0);
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

// ── Cartesian, bar chart, line graph ────────────────────────────────────────

function evaluateFunction(form: string, c: number[], x: number): number | null {
  switch (form) {
    case 'linear': return c[0] * x + c[1];
    case 'quadratic': return c[0] * x * x + c[1] * x + c[2];
    case 'cubic': return c[0] * x ** 3 + c[1] * x * x + c[2] * x + c[3];
    case 'sine': return c[0] * Math.sin(c[1] * x + c[2]);
    case 'cosine': return c[0] * Math.cos(c[1] * x + c[2]);
    case 'exponential': return c[0] * c[1] ** x;
    case 'reciprocal': return x === 0 ? null : c[0] / x;
    default: return null;
  }
}

function axes(t: Transform, xRange: [number, number], yRange: [number, number],
              xLabel?: string, yLabel?: string, grid?: boolean): string[] {
  const out: string[] = [];
  const [x0, x1] = xRange;
  const [y0, y1] = yRange;
  const stepX = niceStep(x1 - x0);
  const stepY = niceStep(y1 - y0);

  if (grid) {
    for (let x = Math.ceil(x0 / stepX) * stepX; x <= x1 + 1e-9; x += stepX) {
      const a = t.toScreen(vec(x, y0));
      const b = t.toScreen(vec(x, y1));
      out.push(line(a.x, a.y, b.x, b.y, { stroke: '#d1d5db', 'stroke-width': 0.8 }));
    }
    for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1 + 1e-9; y += stepY) {
      const a = t.toScreen(vec(x0, y));
      const b = t.toScreen(vec(x1, y));
      out.push(line(a.x, a.y, b.x, b.y, { stroke: '#d1d5db', 'stroke-width': 0.8 }));
    }
  }

  // Axes sit on zero when it is in range, otherwise on the lower edge.
  const axisY = y0 <= 0 && 0 <= y1 ? 0 : y0;
  const axisX = x0 <= 0 && 0 <= x1 ? 0 : x0;
  const xa = t.toScreen(vec(x0, axisY));
  const xb = t.toScreen(vec(x1, axisY));
  const ya = t.toScreen(vec(axisX, y0));
  const yb = t.toScreen(vec(axisX, y1));
  out.push(line(xa.x, xa.y, xb.x, xb.y, { stroke: INK, 'stroke-width': 1.4 }));
  out.push(arrowHead(xb.x, xb.y, 1, 0, 8));
  out.push(line(ya.x, ya.y, yb.x, yb.y, { stroke: INK, 'stroke-width': 1.4 }));
  out.push(arrowHead(yb.x, yb.y, 0, -1, 8));

  for (let x = Math.ceil(x0 / stepX) * stepX; x <= x1 + 1e-9; x += stepX) {
    if (Math.abs(x) < 1e-9) continue;
    const at = t.toScreen(vec(x, axisY));
    out.push(line(at.x, at.y - 3, at.x, at.y + 3, { stroke: INK, 'stroke-width': 1 }));
    out.push(text(at.x, at.y + 14, trimNumber(x), {
      'text-anchor': 'middle', fill: INK, stroke: 'none', 'font-size': 11,
    }));
  }
  for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1 + 1e-9; y += stepY) {
    if (Math.abs(y) < 1e-9) continue;
    const at = t.toScreen(vec(axisX, y));
    out.push(line(at.x - 3, at.y, at.x + 3, at.y, { stroke: INK, 'stroke-width': 1 }));
    out.push(text(at.x - 7, at.y, trimNumber(y), {
      'text-anchor': 'end', 'dominant-baseline': 'middle', fill: INK, stroke: 'none', 'font-size': 11,
    }));
  }

  if (xLabel) {
    out.push(text(xb.x, xb.y + 28, xLabel, {
      'text-anchor': 'end', fill: INK, stroke: 'none', 'font-size': 12,
    }));
  }
  if (yLabel) {
    out.push(text(yb.x + 8, yb.y - 6, yLabel, {
      'text-anchor': 'start', fill: INK, stroke: 'none', 'font-size': 12,
    }));
  }
  return out;
}

/** A 1/2/5 x 10ⁿ step, so tick labels are round numbers. */
function niceStep(span: number): number {
  const target = Math.abs(span) / 6 || 1;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalised = target / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

function trimNumber(value: number): string {
  return fmt(Math.round(value * 1000) / 1000);
}

function renderCartesian(spec: CartesianSpec, options: CanvasOptions): RenderResult {
  const [x0, x1] = spec.xRange;
  const [y0, y1] = spec.yRange;
  const t = createTransform({ minX: x0, maxX: x1, minY: y0, maxY: y1 }, options);
  const body = axes(t, spec.xRange, spec.yRange, spec.xLabel, spec.yLabel, spec.grid);

  for (const fn of spec.functions ?? []) {
    const [d0, d1] = fn.domain ?? spec.xRange;
    const steps = 160;
    let run: Array<[number, number]> = [];
    const flush = () => {
      if (run.length >= 2) body.push(polyline(run, strokeAttrs(fn.style, { 'stroke-width': 1.8 })));
      run = [];
    };
    for (let i = 0; i <= steps; i += 1) {
      const x = d0 + ((d1 - d0) * i) / steps;
      const y = evaluateFunction(fn.form, fn.coefficients, x);
      // A break in the domain (a reciprocal at x = 0) or a value off the
      // canvas ends the current run, so the curve is not joined across the
      // asymptote by a vertical line that is not part of the function.
      if (y === null || !Number.isFinite(y) || y < y0 || y > y1) {
        flush();
        continue;
      }
      const p = t.toScreen(vec(x, y));
      run.push([p.x, p.y]);
    }
    flush();
    if (fn.label) {
      const midX = (d0 + d1) / 2;
      const midY = evaluateFunction(fn.form, fn.coefficients, midX);
      if (midY !== null && Number.isFinite(midY) && midY >= y0 && midY <= y1) {
        const at = t.toScreen(vec(midX, midY));
        body.push(labelAt(at, fn.label, 'above-right', 10, { 'font-size': 12 }));
      }
    }
  }

  const byId = new Map<string, Vec>();
  for (const p of spec.points ?? []) byId.set(p.id, vec(p.x, p.y));

  for (const seg of spec.lines ?? []) {
    const a = byId.get(seg.from)!;
    const b = byId.get(seg.to)!;
    const [pa, pb] = seg.extend
      ? extendSegment(a, b, Math.max(x1 - x0, y1 - y0))
      : [a, b];
    const sa = t.toScreen(pa);
    const sb = t.toScreen(pb);
    body.push(line(sa.x, sa.y, sb.x, sb.y, strokeAttrs(seg.style, { 'stroke-width': 1.8 })));
    if (seg.label) body.push(labelAt(t.toScreen(midpoint(a, b)), seg.label, 'above-right', 10, { 'font-size': 12 }));
  }

  for (const p of spec.points ?? []) {
    if (p.visible === false) continue;
    const at = t.toScreen(vec(p.x, p.y));
    body.push(circle(at.x, at.y, 3, { fill: INK, stroke: 'none' }));
    if (p.label) body.push(labelAt(at, p.label, p.labelPosition ?? 'above-right', 10));
  }

  for (const note of spec.annotations ?? []) {
    const anchors = note.anchor.map((id) => byId.get(id)).filter(Boolean) as Vec[];
    if (!anchors.length) continue;
    const at = anchors.length === 2 ? midpoint(anchors[0], anchors[1]) : anchors[0];
    body.push(labelAt(t.toScreen(at), note.text, note.position ?? 'above', 12, { 'font-size': 12 }));
  }

  return finish(spec.title, t, body);
}

function renderBarChart(spec: BarChartSpec, options: CanvasOptions): RenderResult {
  const width = options.width ?? DEFAULT_CANVAS.WIDTH;
  const height = options.height ?? DEFAULT_CANVAS.HEIGHT;
  const left = 56;
  const right = 20;
  const top = spec.title ? 38 : 22;
  const bottom = 52;

  const highest = spec.values.length ? Math.max(...spec.values, 0) : 1;
  const yMax = spec.yMax ?? niceCeiling(highest);
  const plotWidth = Math.max(width - left - right, 1);
  const plotHeight = Math.max(height - top - bottom, 1);
  const toY = (value: number) => top + plotHeight - (value / (yMax || 1)) * plotHeight;

  const body: string[] = [];
  const step = niceStep(yMax);
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    const y = toY(v);
    body.push(line(left, y, left + plotWidth, y, { stroke: '#d1d5db', 'stroke-width': 0.8 }));
    body.push(text(left - 8, y, trimNumber(v), {
      'text-anchor': 'end', 'dominant-baseline': 'middle', fill: INK, stroke: 'none', 'font-size': 11,
    }));
  }
  body.push(line(left, top, left, top + plotHeight, { stroke: INK, 'stroke-width': 1.4 }));
  body.push(line(left, top + plotHeight, left + plotWidth, top + plotHeight, { stroke: INK, 'stroke-width': 1.4 }));

  const slot = plotWidth / Math.max(spec.categories.length, 1);
  const barWidth = slot * 0.56;
  spec.categories.forEach((category, i) => {
    const value = spec.values[i] ?? 0;
    const x = left + slot * i + (slot - barWidth) / 2;
    const y = toY(Math.max(value, 0));
    const barHeight = Math.abs(top + plotHeight - y);
    body.push(rect(x, y, barWidth, barHeight, { fill: '#e5e7eb', stroke: INK, 'stroke-width': 1.2 }));
    body.push(text(x + barWidth / 2, top + plotHeight + 16, category, {
      'text-anchor': 'middle', fill: INK, stroke: 'none', 'font-size': 11,
    }));
    if (spec.showValues) {
      body.push(text(x + barWidth / 2, y - 6, trimNumber(value), {
        'text-anchor': 'middle', fill: INK, stroke: 'none', 'font-size': 11,
      }));
    }
  });

  if (spec.xLabel) {
    body.push(text(left + plotWidth / 2, height - 12, spec.xLabel, {
      'text-anchor': 'middle', fill: INK, stroke: 'none', 'font-size': 12,
    }));
  }
  if (spec.yLabel) {
    body.push(text(14, top - 8, spec.yLabel, {
      'text-anchor': 'start', fill: INK, stroke: 'none', 'font-size': 12,
    }));
  }

  const svg = svgDocument(width, height, [title(spec.title, width), group(body)]);
  assertSafeSvg(svg);
  return { svg, width, height, rendererVersion: RENDERER_VERSION };
}

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const step = niceStep(value);
  return Math.ceil(value / step) * step;
}

function renderLineGraph(spec: LineGraphSpec, options: CanvasOptions): RenderResult {
  const all = spec.series.flatMap((s) => s.points.map((p) => vec(p.x, p.y)));
  const derived = boundsOf(all);
  const xRange = spec.xRange ?? [derived.minX, derived.maxX];
  const yRange = spec.yRange ?? [Math.min(derived.minY, 0), derived.maxY];
  const safeX: [number, number] = xRange[0] === xRange[1] ? [xRange[0], xRange[0] + 1] : xRange;
  const safeY: [number, number] = yRange[0] === yRange[1] ? [yRange[0], yRange[0] + 1] : yRange;

  const t = createTransform({ minX: safeX[0], maxX: safeX[1], minY: safeY[0], maxY: safeY[1] }, options);
  const body = axes(t, safeX, safeY, spec.xLabel, spec.yLabel, spec.grid);

  for (const series of spec.series) {
    const pts = series.points.map((p) => {
      const s = t.toScreen(vec(p.x, p.y));
      return [s.x, s.y] as [number, number];
    });
    body.push(polyline(pts, strokeAttrs(series.style, { 'stroke-width': 1.8 })));
    if (series.markers) {
      for (const [x, y] of pts) body.push(circle(x, y, 2.6, { fill: INK, stroke: 'none' }));
    }
    if (series.label && pts.length) {
      const [lx, ly] = pts[pts.length - 1];
      body.push(text(lx + 6, ly, series.label, {
        'text-anchor': 'start', 'dominant-baseline': 'middle', fill: INK, stroke: 'none', 'font-size': 12,
      }));
    }
  }

  return finish(spec.title, t, body);
}

// ── Physics ─────────────────────────────────────────────────────────────────

/**
 * A ray diagram, constructed from the optics rather than drawn by eye.
 *
 * Sign convention: converging devices (concave mirror, convex lens) take a
 * positive focal length, diverging ones negative. The image distance follows
 * from the mirror/lens equation, so the drawing cannot contradict the physics.
 */
function renderRayDiagram(spec: RayDiagramSpec, options: CanvasOptions): RenderResult {
  const converging = spec.device === 'concave_mirror' || spec.device === 'convex_lens';
  const isMirror = spec.device === 'concave_mirror' || spec.device === 'convex_mirror';
  const f = converging ? spec.focalLength : -spec.focalLength;
  const u = spec.objectDistance;
  const v = thinLensImageDistance(u, f);
  const m = v === null ? 0 : magnification(u, v);
  const imageHeight = v === null ? 0 : m * spec.objectHeight;

  // The object stands on the axis to the left of the device at x = 0.
  const objectX = -u;
  // A real image forms on the far side for a lens and on the near side for a
  // mirror; both are drawn at |v| with the sign the equation gives.
  const imageX = v === null ? 0 : (isMirror ? -v : v);

  const interesting: Vec[] = [
    vec(0, 0), vec(objectX, 0), vec(objectX, spec.objectHeight),
    vec(-Math.abs(f), 0), vec(Math.abs(f), 0),
    vec(-2 * Math.abs(f), 0), vec(2 * Math.abs(f), 0),
  ];
  if (v !== null) interesting.push(vec(imageX, imageHeight), vec(imageX, 0));
  const span = boundsOf(interesting);
  const pad = Math.max(span.maxX - span.minX, span.maxY - span.minY) * 0.12;
  const t = createTransform(expandBounds(span, pad), options);

  const body: string[] = [];
  const axisA = t.toScreen(vec(span.minX - pad, 0));
  const axisB = t.toScreen(vec(span.maxX + pad, 0));
  body.push(line(axisA.x, axisA.y, axisB.x, axisB.y, { stroke: INK, 'stroke-width': 1.2, 'stroke-dasharray': '6 4' }));

  // The device itself.
  const top = t.toScreen(vec(0, Math.max(spec.objectHeight, Math.abs(imageHeight)) * 1.4));
  const bottom = t.toScreen(vec(0, -Math.max(spec.objectHeight, Math.abs(imageHeight)) * 1.4));
  if (isMirror) {
    const bulge = spec.device === 'concave_mirror' ? -18 : 18;
    body.push(path(
      `M ${fmt(top.x)} ${fmt(top.y)} Q ${fmt(top.x + bulge)} ${fmt((top.y + bottom.y) / 2)} ${fmt(bottom.x)} ${fmt(bottom.y)}`,
      { stroke: INK, 'stroke-width': 2.4, fill: 'none' },
    ));
  } else {
    body.push(line(top.x, top.y, bottom.x, bottom.y, { stroke: INK, 'stroke-width': 2 }));
    const head = spec.device === 'convex_lens' ? 7 : -7;
    body.push(arrowHead(top.x, top.y, 0, -1, Math.abs(head)));
    body.push(arrowHead(bottom.x, bottom.y, 0, 1, Math.abs(head)));
  }

  // Focus and centre of curvature markers.
  //
  // A lens has a focus on each side, so both are drawn. A MIRROR does not:
  // F and C lie only on the reflecting side, and drawing them behind the
  // mirror as well is a physics error that makes a textbook figure wrong.
  const markers: Array<[number, string]> = isMirror
    ? [[-Math.abs(f), 'F'], [-2 * Math.abs(f), 'C']]
    : [[-Math.abs(f), 'F'], [Math.abs(f), 'F'],
      [-2 * Math.abs(f), 'C'], [2 * Math.abs(f), 'C']];
  for (const [x, glyph] of markers) {
    const at = t.toScreen(vec(x, 0));
    body.push(circle(at.x, at.y, 2.4, { fill: INK, stroke: 'none' }));
    body.push(text(at.x, at.y + 16, glyph === 'F' ? (spec.labels?.focus ?? 'F') : (spec.labels?.centre ?? 'C'), {
      'text-anchor': 'middle', fill: INK, stroke: 'none', 'font-size': 11,
    }));
  }

  // Object arrow.
  const objBase = t.toScreen(vec(objectX, 0));
  const objTip = t.toScreen(vec(objectX, spec.objectHeight));
  body.push(line(objBase.x, objBase.y, objTip.x, objTip.y, { stroke: INK, 'stroke-width': 2 }));
  body.push(arrowHead(objTip.x, objTip.y, 0, -1, 8));
  body.push(text(objTip.x, objTip.y - 12, spec.labels?.object ?? 'Object', {
    'text-anchor': 'middle', fill: INK, stroke: 'none', 'font-size': 12,
  }));

  if (spec.showPrincipalRays !== false && v !== null) {
    const tip = vec(objectX, spec.objectHeight);
    const pole = vec(0, spec.objectHeight);
    const imageTip = vec(imageX, imageHeight);
    const rayAttrs = { stroke: INK, 'stroke-width': 1.2 };
    // Ray 1: parallel to the axis, then through the focus.
    drawRay(body, t, tip, pole, rayAttrs);
    drawRay(body, t, pole, imageTip, rayAttrs);
    // Ray 2: through the optical centre / pole, undeviated.
    drawRay(body, t, tip, imageTip, rayAttrs);
  }

  if (spec.showImage !== false && v !== null && Math.abs(imageHeight) > 1e-9) {
    const imgBase = t.toScreen(vec(imageX, 0));
    const imgTip = t.toScreen(vec(imageX, imageHeight));
    const virtual = (isMirror && v < 0) || (!isMirror && v < 0);
    body.push(line(imgBase.x, imgBase.y, imgTip.x, imgTip.y, {
      stroke: INK, 'stroke-width': 2, ...(virtual ? { 'stroke-dasharray': '5 4' } : {}),
    }));
    body.push(arrowHead(imgTip.x, imgTip.y, 0, imageHeight >= 0 ? -1 : 1, 8));
    body.push(text(imgTip.x, imgTip.y + (imageHeight >= 0 ? -12 : 16), spec.labels?.image ?? 'Image', {
      'text-anchor': 'middle', fill: INK, stroke: 'none', 'font-size': 12,
    }));
  }

  return finish(spec.title, t, body);
}

function drawRay(body: string[], t: Transform, a: Vec, b: Vec, attrs: Attrs) {
  const sa = t.toScreen(a);
  const sb = t.toScreen(b);
  body.push(line(sa.x, sa.y, sb.x, sb.y, attrs));
}

function renderForceDiagram(spec: ForceDiagramSpec, options: CanvasOptions): RenderResult {
  const width = options.width ?? DEFAULT_CANVAS.WIDTH;
  const height = options.height ?? DEFAULT_CANVAS.HEIGHT;
  const cx = width / 2;
  const cy = height / 2 + (spec.title ? 8 : 0);

  const longest = Math.max(...spec.forces.map((f) => f.magnitude), 1);
  const maxLength = Math.min(width, height) * 0.32;
  const body: string[] = [];

  if (spec.body.shape === 'block') {
    body.push(rect(cx - 30, cy - 22, 60, 44, { fill: '#f3f4f6', stroke: INK, 'stroke-width': 1.8 }));
  } else {
    body.push(circle(cx, cy, 26, { fill: '#f3f4f6', stroke: INK, 'stroke-width': 1.8 }));
  }
  if (spec.body.label) {
    body.push(text(cx, cy, spec.body.label, {
      'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: INK, stroke: 'none', 'font-size': 12,
    }));
  }

  let sumX = 0;
  let sumY = 0;
  for (const force of spec.forces) {
    const radians = (force.angleDeg * Math.PI) / 180;
    const ux = Math.cos(radians);
    // Screen y grows downward, so an anticlockwise angle points up on screen.
    const uy = -Math.sin(radians);
    const len = (force.magnitude / longest) * maxLength;
    const startX = cx + ux * 28;
    const startY = cy + uy * 28;
    const endX = cx + ux * (28 + len);
    const endY = cy + uy * (28 + len);
    body.push(line(startX, startY, endX, endY, { stroke: INK, 'stroke-width': 1.8 }));
    body.push(arrowHead(endX, endY, ux, uy, 10));
    if (force.label) {
      body.push(text(endX + ux * 12, endY + uy * 12, force.label, {
        'text-anchor': ux > 0.3 ? 'start' : ux < -0.3 ? 'end' : 'middle',
        'dominant-baseline': uy > 0.3 ? 'hanging' : uy < -0.3 ? 'auto' : 'middle',
        fill: INK, stroke: 'none', 'font-size': 12,
      }));
    }
    sumX += Math.cos(radians) * force.magnitude;
    sumY += Math.sin(radians) * force.magnitude;
  }

  if (spec.showResultant) {
    const magnitude = Math.hypot(sumX, sumY);
    if (magnitude > 1e-9) {
      const ux = sumX / magnitude;
      const uy = -sumY / magnitude;
      const len = (magnitude / longest) * maxLength;
      const endX = cx + ux * (28 + len);
      const endY = cy + uy * (28 + len);
      body.push(line(cx + ux * 28, cy + uy * 28, endX, endY, {
        stroke: INK, 'stroke-width': 1.8, 'stroke-dasharray': '6 4',
      }));
      body.push(arrowHead(endX, endY, ux, uy, 10));
      body.push(text(endX + ux * 14, endY + uy * 14, 'Resultant', {
        'text-anchor': 'middle', fill: INK, stroke: 'none', 'font-size': 11,
      }));
    }
  }

  const svg = svgDocument(width, height, [title(spec.title, width), group(body)]);
  assertSafeSvg(svg);
  return { svg, width, height, rendererVersion: RENDERER_VERSION };
}

// ── Templates ───────────────────────────────────────────────────────────────

function renderTemplate(spec: TemplateSpec, options: CanvasOptions): RenderResult {
  const factory = DIAGRAM_TEMPLATES[spec.template];
  if (!factory) {
    throw new DiagramRenderError(`unknown template "${spec.template}"`);
  }
  const template = factory();
  const slotIds = new Set(template.slots.map((s) => s.id));

  // An unknown slot is rejected rather than ignored: silently dropping a label
  // would give a teacher a diagram missing the thing they asked to label, with
  // no indication why.
  for (const slot of Object.keys(spec.labels ?? {})) {
    if (!slotIds.has(slot)) {
      throw new DiagramRenderError(
        `template "${spec.template}" has no slot "${slot}" (available: ${[...slotIds].join(', ')})`,
      );
    }
  }
  for (const slot of spec.hideLabels ?? []) {
    if (!slotIds.has(slot)) {
      throw new DiagramRenderError(
        `template "${spec.template}" has no slot "${slot}" (available: ${[...slotIds].join(', ')})`,
      );
    }
  }

  const width = options.width ?? DEFAULT_CANVAS.WIDTH;
  const height = options.height ?? DEFAULT_CANVAS.HEIGHT;
  // Templates draw in 0..100 but place labels outside it, so the mapped area
  // is widened to keep leader text on the canvas.
  const t = createTransform({ minX: -32, maxX: 132, minY: -4, maxY: 104 }, { width, height, margin: 12 });

  const artwork = template.draw().map((markup) => markup);
  const origin = t.toScreen(vec(0, 100));
  const scaled = group(artwork, {
    transform: `translate(${fmt(origin.x)} ${fmt(origin.y)}) scale(${fmt(t.scale)})`,
    // A scale() multiplies stroke width as well as geometry, so template line
    // art came out several times too heavy — a cell wall thicker than the
    // nucleus. Pre-dividing keeps the drawn weight the same as every other
    // diagram's, and unlike vector-effect="non-scaling-stroke" it needs no
    // support from whatever eventually rasterises this for a PDF.
    'stroke-width': 1.6 / (t.scale || 1),
  });

  const hidden = new Set(spec.hideLabels ?? []);
  const labels: string[] = [];
  for (const slot of template.slots) {
    if (hidden.has(slot.id)) continue;
    const content = spec.labels?.[slot.id] ?? slot.defaultLabel;
    labels.push(...leader(t, slot, content));
  }

  const svg = svgDocument(width, height, [title(spec.title, width), scaled, group(labels)]);
  assertSafeSvg(svg);
  return { svg, width, height, rendererVersion: RENDERER_VERSION };
}

/** A leader line from the artwork to its label. */
function leader(t: Transform, slot: TemplateSlot, content: string): string[] {
  const from = t.toScreen(vec(slot.x, 100 - slot.y));
  const to = t.toScreen(vec(slot.labelX, 100 - slot.labelY));
  return [
    line(from.x, from.y, to.x, to.y, { stroke: '#6b7280', 'stroke-width': 0.9 }),
    circle(from.x, from.y, 2, { fill: '#6b7280', stroke: 'none' }),
    text(to.x + (slot.anchor === 'start' ? 4 : slot.anchor === 'end' ? -4 : 0), to.y, content, {
      'text-anchor': slot.anchor, 'dominant-baseline': 'middle',
      fill: INK, stroke: 'none', 'font-size': 11,
    }),
  ];
}

// ── Entry point ─────────────────────────────────────────────────────────────

function finish(t: string | undefined, transform: Transform, body: string[]): RenderResult {
  const svg = svgDocument(transform.width, transform.height, [
    title(t, transform.width),
    group(body),
  ]);
  assertSafeSvg(svg);
  return {
    svg, width: transform.width, height: transform.height, rendererVersion: RENDERER_VERSION,
  };
}

/**
 * Render a VALIDATED specification.
 *
 * The input must already have passed validateDiagramSpec: this function trusts
 * the structure (references resolve, enums are members, numbers are finite)
 * and would throw rather than emit nonsense if handed raw input.
 */
export function renderDiagram(spec: DiagramSpec, options: CanvasOptions = {}): RenderResult {
  switch (spec.kind) {
    case 'geometry': return renderGeometry(spec, options);
    case 'cartesian': return renderCartesian(spec, options);
    case 'bar_chart': return renderBarChart(spec, options);
    case 'line_graph': return renderLineGraph(spec, options);
    case 'ray_diagram': return renderRayDiagram(spec, options);
    case 'force_diagram': return renderForceDiagram(spec, options);
    case 'template': return renderTemplate(spec, options);
    default:
      throw new DiagramRenderError(`no renderer for diagram kind "${(spec as any)?.kind}"`);
  }
}

export { RENDERER_VERSION };
