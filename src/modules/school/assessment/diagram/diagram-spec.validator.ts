/**
 * Diagram specification validation.
 *
 * Input here is model output or teacher input — untrusted in both cases. The
 * job is to decide whether a specification may reach the renderer at all, and
 * to say precisely why when it may not, because a validation error is shown to
 * a teacher who has to fix it.
 *
 * Three rules shape the design:
 *
 * 1. COLLECT, DON'T THROW ON FIRST ERROR. A specification with four problems
 *    should report four problems. Fixing them one round trip at a time is a
 *    bad teacher experience and a worse model-repair loop.
 *
 * 2. REJECT, NEVER REPAIR. Clamping a coordinate or truncating a label would
 *    produce a diagram that is quietly different from what was asked for, and
 *    a quietly wrong diagram on an exam paper is the one outcome worth the
 *    most effort to avoid. The only normalisation performed is dropping
 *    fields the schema does not define.
 *
 * 3. THE OUTPUT IS A FRESH OBJECT. validate() rebuilds the specification from
 *    known fields rather than returning the input, so anything the caller
 *    smuggled in — a `style`, an `href`, a `__proto__` — cannot survive into
 *    storage or the renderer. Whitelisting on the way out is what makes the
 *    schema's "no field can hold a URL" guarantee true in practice, rather
 *    than only true of the type declaration.
 *
 * No validation library: class-validator is decorator-and-class based, which
 * fits a fixed DTO rather than a discriminated union with cross-field
 * mathematics, and would not give per-field messages for a union arm. Adding a
 * schema library for one module would be a dependency for no gain.
 */
import {
  ARROW_STYLES,
  DIAGRAM_KINDS,
  DIAGRAM_LIMITS,
  DIAGRAM_TEMPLATE_IDS,
  FUNCTION_ARITY,
  FUNCTION_FORMS,
  LABEL_POSITIONS,
  OPTICAL_DEVICES,
  STROKE_STYLES,
  type DiagramSpec,
  type GeometryShape,
  type SpecAnnotation,
  type SpecPoint,
} from './diagram-spec.types';

export interface DiagramValidationResult {
  valid: boolean;
  /** Present only when valid — a rebuilt, whitelisted specification. */
  spec?: DiagramSpec;
  errors: string[];
}

/** Collects errors with a field path, so a message names what to fix. */
class Errors {
  readonly list: string[] = [];
  add(path: string, message: string) {
    this.list.push(`${path}: ${message}`);
  }
  get ok() {
    return this.list.length === 0;
  }
}

// ── Primitive checks ────────────────────────────────────────────────────────

function isPlainObject(value: any): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function num(errors: Errors, path: string, value: any, opts: {
  min?: number; max?: number; positive?: boolean; integer?: boolean;
} = {}): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.add(path, 'must be a finite number');
    return undefined;
  }
  const min = opts.min ?? DIAGRAM_LIMITS.COORD_MIN;
  const max = opts.max ?? DIAGRAM_LIMITS.COORD_MAX;
  if (value < min || value > max) {
    errors.add(path, `must be between ${min} and ${max}`);
    return undefined;
  }
  if (opts.positive && value <= 0) {
    errors.add(path, 'must be greater than zero');
    return undefined;
  }
  if (opts.integer && !Number.isInteger(value)) {
    errors.add(path, 'must be a whole number');
    return undefined;
  }
  return value;
}

/**
 * A short human label.
 *
 * `<` and `>` are ALLOWED: they are ordinary mathematics ("x < 5"), and the
 * renderer escapes every text node on the way out, which is where escaping
 * belongs. What is rejected is text that cannot be a label at all — control
 * characters, including the NUL that terminates a C string and the newlines
 * that would break out of a text node's layout.
 */
function label(
  errors: Errors,
  path: string,
  value: any,
  // Explicitly `number`: DIAGRAM_LIMITS is `as const`, so an inferred default
  // would narrow this parameter to the literal 48 and reject the title cap.
  max: number = DIAGRAM_LIMITS.MAX_LABEL_CHARS,
): string | undefined {
  if (typeof value !== 'string') {
    errors.add(path, 'must be a string');
    return undefined;
  }
  if (value.length > max) {
    errors.add(path, `must be at most ${max} characters`);
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    errors.add(path, 'must not contain control characters');
    return undefined;
  }
  return value;
}

function id(errors: Errors, path: string, value: any): string | undefined {
  if (typeof value !== 'string') {
    errors.add(path, 'must be a string identifier');
    return undefined;
  }
  if (!DIAGRAM_LIMITS.ID_PATTERN.test(value)) {
    errors.add(path, 'must start with a letter and use only letters, digits, underscore or prime');
    return undefined;
  }
  return value;
}

function enumValue<T extends string>(
  errors: Errors, path: string, value: any, allowed: readonly T[],
): T | undefined {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.add(path, `must be one of: ${allowed.join(', ')}`);
    return undefined;
  }
  return value as T;
}

function boolOrUndefined(value: any): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function range(errors: Errors, path: string, value: any): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    errors.add(path, 'must be a pair [min, max]');
    return undefined;
  }
  const lo = num(errors, `${path}[0]`, value[0]);
  const hi = num(errors, `${path}[1]`, value[1]);
  if (lo === undefined || hi === undefined) return undefined;
  if (!(lo < hi)) {
    errors.add(path, 'min must be less than max');
    return undefined;
  }
  return [lo, hi];
}

function array(errors: Errors, path: string, value: any, max: number, required = true): any[] | undefined {
  if (value === undefined || value === null) {
    if (required) errors.add(path, 'is required');
    return required ? undefined : [];
  }
  if (!Array.isArray(value)) {
    errors.add(path, 'must be an array');
    return undefined;
  }
  if (value.length > max) {
    errors.add(path, `must contain at most ${max} items`);
    return undefined;
  }
  return value;
}

// ── Shared structures ───────────────────────────────────────────────────────

function points(errors: Errors, path: string, raw: any, required: boolean): SpecPoint[] {
  const items = array(errors, path, raw, DIAGRAM_LIMITS.MAX_POINTS, required);
  if (!items) return [];
  const out: SpecPoint[] = [];
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const at = `${path}[${i}]`;
    if (!isPlainObject(item)) {
      errors.add(at, 'must be an object');
      return;
    }
    const pid = id(errors, `${at}.id`, item.id);
    const x = num(errors, `${at}.x`, item.x);
    const y = num(errors, `${at}.y`, item.y);
    if (pid === undefined || x === undefined || y === undefined) return;
    if (seen.has(pid)) {
      errors.add(at, `duplicate point id "${pid}"`);
      return;
    }
    seen.add(pid);
    const point: SpecPoint = { id: pid, x, y };
    if (item.label !== undefined) {
      const text = label(errors, `${at}.label`, item.label);
      if (text !== undefined) point.label = text;
    }
    if (item.labelPosition !== undefined) {
      const pos = enumValue(errors, `${at}.labelPosition`, item.labelPosition, LABEL_POSITIONS);
      if (pos !== undefined) point.labelPosition = pos;
    }
    const visible = boolOrUndefined(item.visible);
    if (visible !== undefined) point.visible = visible;
    out.push(point);
  });
  return out;
}

function annotations(errors: Errors, path: string, raw: any, known: Set<string>): SpecAnnotation[] {
  const items = array(errors, path, raw, DIAGRAM_LIMITS.MAX_ANNOTATIONS, false);
  if (!items || !items.length) return [];
  const out: SpecAnnotation[] = [];
  items.forEach((item, i) => {
    const at = `${path}[${i}]`;
    if (!isPlainObject(item)) {
      errors.add(at, 'must be an object');
      return;
    }
    const anchors = array(errors, `${at}.anchor`, item.anchor, 2);
    const text = label(errors, `${at}.text`, item.text);
    if (!anchors || text === undefined) return;
    if (anchors.length < 1) {
      errors.add(`${at}.anchor`, 'must name one or two points');
      return;
    }
    const refs: string[] = [];
    anchors.forEach((ref, j) => {
      const value = id(errors, `${at}.anchor[${j}]`, ref);
      if (value === undefined) return;
      if (!known.has(value)) {
        errors.add(`${at}.anchor[${j}]`, `unknown point "${value}"`);
        return;
      }
      refs.push(value);
    });
    if (refs.length !== anchors.length) return;
    const annotation: SpecAnnotation = { anchor: refs, text };
    if (item.position !== undefined) {
      const pos = enumValue(errors, `${at}.position`, item.position, LABEL_POSITIONS);
      if (pos !== undefined) annotation.position = pos;
    }
    out.push(annotation);
  });
  return out;
}

/** A reference to a declared point. */
function ref(errors: Errors, path: string, value: any, known: Set<string>): string | undefined {
  const value2 = id(errors, path, value);
  if (value2 === undefined) return undefined;
  if (!known.has(value2)) {
    errors.add(path, `unknown point "${value2}"`);
    return undefined;
  }
  return value2;
}

function optionalStroke(errors: Errors, path: string, value: any) {
  return value === undefined ? undefined : enumValue(errors, path, value, STROKE_STYLES);
}

// ── Geometry ────────────────────────────────────────────────────────────────

function geometryShapes(
  errors: Errors, raw: any, known: Set<string>, circles: Set<string>,
): GeometryShape[] {
  const items = array(errors, 'shapes', raw, DIAGRAM_LIMITS.MAX_SHAPES);
  if (!items) return [];
  const out: GeometryShape[] = [];

  items.forEach((item, i) => {
    const at = `shapes[${i}]`;
    if (!isPlainObject(item)) {
      errors.add(at, 'must be an object');
      return;
    }
    const type = item.type;
    const stroke = optionalStroke(errors, `${at}.style`, item.style);
    const withStroke = <T extends object>(shape: T) =>
      (stroke ? { ...shape, style: stroke } : shape);

    switch (type) {
      case 'circle': {
        const center = ref(errors, `${at}.center`, item.center, known);
        const radius = num(errors, `${at}.radius`, item.radius, { positive: true });
        if (center === undefined || radius === undefined) return;
        const shape: any = { type: 'circle', center, radius };
        if (item.id !== undefined) {
          const cid = id(errors, `${at}.id`, item.id);
          if (cid === undefined) return;
          shape.id = cid;
        }
        out.push(withStroke(shape) as GeometryShape);
        return;
      }
      case 'segment': {
        const from = ref(errors, `${at}.from`, item.from, known);
        const to = ref(errors, `${at}.to`, item.to, known);
        if (from === undefined || to === undefined) return;
        if (from === to) {
          errors.add(at, 'a segment needs two distinct points');
          return;
        }
        const shape: any = { type: 'segment', from, to };
        if (item.arrow !== undefined) {
          const arrow = enumValue(errors, `${at}.arrow`, item.arrow, ARROW_STYLES);
          if (arrow === undefined) return;
          shape.arrow = arrow;
        }
        if (item.measure !== undefined) {
          const measure = label(errors, `${at}.measure`, item.measure);
          if (measure === undefined) return;
          shape.measure = measure;
        }
        out.push(withStroke(shape) as GeometryShape);
        return;
      }
      case 'polygon': {
        const vertices = array(errors, `${at}.vertices`, item.vertices, DIAGRAM_LIMITS.MAX_POLYGON_VERTICES);
        if (!vertices) return;
        if (vertices.length < 3) {
          errors.add(`${at}.vertices`, 'a polygon needs at least 3 points (a triangle is 3)');
          return;
        }
        const resolved: string[] = [];
        vertices.forEach((v, j) => {
          const value = ref(errors, `${at}.vertices[${j}]`, v, known);
          if (value !== undefined) resolved.push(value);
        });
        if (resolved.length !== vertices.length) return;
        if (new Set(resolved).size !== resolved.length) {
          errors.add(`${at}.vertices`, 'vertices must be distinct');
          return;
        }
        out.push(withStroke({ type: 'polygon', vertices: resolved }) as GeometryShape);
        return;
      }
      case 'chord':
      case 'diameter':
      case 'secant': {
        const circle = ref(errors, `${at}.circle`, item.circle, circles);
        const from = ref(errors, `${at}.from`, item.from, known);
        const to = ref(errors, `${at}.to`, item.to, known);
        if (circle === undefined || from === undefined || to === undefined) return;
        if (from === to) {
          errors.add(at, `a ${type} needs two distinct points`);
          return;
        }
        const shape: any = { type, circle, from, to };
        if (item.measure !== undefined && type !== 'secant') {
          const measure = label(errors, `${at}.measure`, item.measure);
          if (measure === undefined) return;
          shape.measure = measure;
        }
        out.push(withStroke(shape) as GeometryShape);
        return;
      }
      case 'radius': {
        const circle = ref(errors, `${at}.circle`, item.circle, circles);
        const to = ref(errors, `${at}.to`, item.to, known);
        if (circle === undefined || to === undefined) return;
        const shape: any = { type: 'radius', circle, to };
        if (item.measure !== undefined) {
          const measure = label(errors, `${at}.measure`, item.measure);
          if (measure === undefined) return;
          shape.measure = measure;
        }
        out.push(withStroke(shape) as GeometryShape);
        return;
      }
      case 'tangent': {
        const circle = ref(errors, `${at}.circle`, item.circle, circles);
        const point = ref(errors, `${at}.at`, item.at, known);
        const length = num(errors, `${at}.length`, item.length, { positive: true });
        if (circle === undefined || point === undefined || length === undefined) return;
        out.push(withStroke({ type: 'tangent', circle, at: point, length }) as GeometryShape);
        return;
      }
      case 'perpendicular': {
        const from = ref(errors, `${at}.from`, item.from, known);
        const segment = array(errors, `${at}.segment`, item.segment, 2);
        if (from === undefined || !segment) return;
        if (segment.length !== 2) {
          errors.add(`${at}.segment`, 'must name exactly two points');
          return;
        }
        const a = ref(errors, `${at}.segment[0]`, segment[0], known);
        const b = ref(errors, `${at}.segment[1]`, segment[1], known);
        if (a === undefined || b === undefined) return;
        if (a === b) {
          errors.add(`${at}.segment`, 'must name two distinct points');
          return;
        }
        const shape: any = { type: 'perpendicular', from, segment: [a, b] };
        if (item.foot !== undefined) {
          const foot = ref(errors, `${at}.foot`, item.foot, known);
          if (foot === undefined) return;
          shape.foot = foot;
        }
        out.push(withStroke(shape) as GeometryShape);
        return;
      }
      case 'angle': {
        const at1 = ref(errors, `${at}.at`, item.at, known);
        const from = ref(errors, `${at}.from`, item.from, known);
        const to = ref(errors, `${at}.to`, item.to, known);
        if (at1 === undefined || from === undefined || to === undefined) return;
        if (new Set([at1, from, to]).size !== 3) {
          errors.add(at, 'an angle needs three distinct points');
          return;
        }
        const shape: any = { type: 'angle', at: at1, from, to };
        if (item.label !== undefined) {
          const text = label(errors, `${at}.label`, item.label);
          if (text === undefined) return;
          shape.label = text;
        }
        const right = boolOrUndefined(item.rightAngle);
        if (right !== undefined) shape.rightAngle = right;
        out.push(shape as GeometryShape);
        return;
      }
      default:
        errors.add(`${at}.type`, `unsupported shape type "${String(type)}"`);
    }
  });

  return out;
}

function validateGeometry(errors: Errors, raw: any): DiagramSpec | undefined {
  const pts = points(errors, 'points', raw.points, true);
  if (!pts.length) {
    errors.add('points', 'at least one point is required');
  }
  const known = new Set(pts.map((p) => p.id));

  // A shape may only be attached to a circle that this specification declares.
  const circleIds = new Set<string>();
  if (Array.isArray(raw.shapes)) {
    for (const shape of raw.shapes) {
      if (isPlainObject(shape) && shape.type === 'circle' && typeof shape.center === 'string') {
        circleIds.add(shape.center);
      }
    }
  }

  const shapes = geometryShapes(errors, raw.shapes, known, circleIds);
  if (!shapes.length) {
    errors.add('shapes', 'at least one shape is required');
  }

  const spec: any = { kind: 'geometry', points: pts, shapes };
  if (raw.title !== undefined) {
    const title = label(errors, 'title', raw.title, DIAGRAM_LIMITS.MAX_TITLE_CHARS);
    if (title !== undefined) spec.title = title;
  }
  const notes = annotations(errors, 'annotations', raw.annotations, known);
  if (notes.length) spec.annotations = notes;
  return spec;
}

// ── Mathematics ─────────────────────────────────────────────────────────────

function validateCartesian(errors: Errors, raw: any): DiagramSpec | undefined {
  const xRange = range(errors, 'xRange', raw.xRange);
  const yRange = range(errors, 'yRange', raw.yRange);
  const pts = points(errors, 'points', raw.points, false);
  const known = new Set(pts.map((p) => p.id));

  const spec: any = { kind: 'cartesian' };
  if (xRange) spec.xRange = xRange;
  if (yRange) spec.yRange = yRange;
  if (pts.length) spec.points = pts;

  for (const key of ['title', 'xLabel', 'yLabel'] as const) {
    if (raw[key] === undefined) continue;
    const max = key === 'title' ? DIAGRAM_LIMITS.MAX_TITLE_CHARS : DIAGRAM_LIMITS.MAX_LABEL_CHARS;
    const text = label(errors, key, raw[key], max);
    if (text !== undefined) spec[key] = text;
  }
  const grid = boolOrUndefined(raw.grid);
  if (grid !== undefined) spec.grid = grid;

  const fns = array(errors, 'functions', raw.functions, DIAGRAM_LIMITS.MAX_FUNCTIONS, false);
  if (fns && fns.length) {
    const out: any[] = [];
    fns.forEach((fn, i) => {
      const at = `functions[${i}]`;
      if (!isPlainObject(fn)) {
        errors.add(at, 'must be an object');
        return;
      }
      const form = enumValue(errors, `${at}.form`, fn.form, FUNCTION_FORMS);
      const coefficients = array(errors, `${at}.coefficients`, fn.coefficients, DIAGRAM_LIMITS.MAX_COEFFICIENTS);
      if (form === undefined || !coefficients) return;
      const arity = FUNCTION_ARITY[form];
      if (coefficients.length !== arity) {
        errors.add(`${at}.coefficients`, `${form} requires exactly ${arity} coefficient(s)`);
        return;
      }
      const values: number[] = [];
      coefficients.forEach((c, j) => {
        const value = num(errors, `${at}.coefficients[${j}]`, c);
        if (value !== undefined) values.push(value);
      });
      if (values.length !== arity) return;
      // A reciprocal with k = 0 is the x-axis, not a curve; and an exponential
      // with a non-positive base is not a real function over the domain.
      if (form === 'reciprocal' && values[0] === 0) {
        errors.add(`${at}.coefficients[0]`, 'reciprocal k must not be zero');
        return;
      }
      if (form === 'exponential' && values[1] <= 0) {
        errors.add(`${at}.coefficients[1]`, 'exponential base must be greater than zero');
        return;
      }
      const entry: any = { form, coefficients: values };
      if (fn.domain !== undefined) {
        const domain = range(errors, `${at}.domain`, fn.domain);
        if (domain === undefined) return;
        entry.domain = domain;
      }
      if (fn.label !== undefined) {
        const text = label(errors, `${at}.label`, fn.label);
        if (text === undefined) return;
        entry.label = text;
      }
      const style = optionalStroke(errors, `${at}.style`, fn.style);
      if (style) entry.style = style;
      out.push(entry);
    });
    if (out.length) spec.functions = out;
  }

  const lines = array(errors, 'lines', raw.lines, DIAGRAM_LIMITS.MAX_SHAPES, false);
  if (lines && lines.length) {
    const out: any[] = [];
    lines.forEach((line, i) => {
      const at = `lines[${i}]`;
      if (!isPlainObject(line)) {
        errors.add(at, 'must be an object');
        return;
      }
      const from = ref(errors, `${at}.from`, line.from, known);
      const to = ref(errors, `${at}.to`, line.to, known);
      if (from === undefined || to === undefined) return;
      if (from === to) {
        errors.add(at, 'a line needs two distinct points');
        return;
      }
      const entry: any = { from, to };
      if (line.label !== undefined) {
        const text = label(errors, `${at}.label`, line.label);
        if (text === undefined) return;
        entry.label = text;
      }
      const style = optionalStroke(errors, `${at}.style`, line.style);
      if (style) entry.style = style;
      const extend = boolOrUndefined(line.extend);
      if (extend !== undefined) entry.extend = extend;
      out.push(entry);
    });
    if (out.length) spec.lines = out;
  }

  const notes = annotations(errors, 'annotations', raw.annotations, known);
  if (notes.length) spec.annotations = notes;
  return spec;
}

function validateBarChart(errors: Errors, raw: any): DiagramSpec | undefined {
  const categories = array(errors, 'categories', raw.categories, DIAGRAM_LIMITS.MAX_CATEGORIES);
  const values = array(errors, 'values', raw.values, DIAGRAM_LIMITS.MAX_CATEGORIES);
  if (!categories || !values) return undefined;
  if (!categories.length) errors.add('categories', 'at least one category is required');
  if (categories.length !== values.length) {
    errors.add('values', `must have one value per category (${categories.length} expected, ${values.length} given)`);
  }
  const names: string[] = [];
  categories.forEach((c, i) => {
    const text = label(errors, `categories[${i}]`, c);
    if (text !== undefined) names.push(text);
  });
  const numbers: number[] = [];
  values.forEach((v, i) => {
    const value = num(errors, `values[${i}]`, v);
    if (value !== undefined) numbers.push(value);
  });

  const spec: any = { kind: 'bar_chart', categories: names, values: numbers };
  for (const key of ['title', 'xLabel', 'yLabel'] as const) {
    if (raw[key] === undefined) continue;
    const max = key === 'title' ? DIAGRAM_LIMITS.MAX_TITLE_CHARS : DIAGRAM_LIMITS.MAX_LABEL_CHARS;
    const text = label(errors, key, raw[key], max);
    if (text !== undefined) spec[key] = text;
  }
  if (raw.yMax !== undefined) {
    const yMax = num(errors, 'yMax', raw.yMax);
    if (yMax !== undefined) {
      const highest = numbers.length ? Math.max(...numbers) : 0;
      if (yMax < highest) errors.add('yMax', 'must be at least the largest value');
      else spec.yMax = yMax;
    }
  }
  const showValues = boolOrUndefined(raw.showValues);
  if (showValues !== undefined) spec.showValues = showValues;
  return spec;
}

function validateLineGraph(errors: Errors, raw: any): DiagramSpec | undefined {
  const series = array(errors, 'series', raw.series, DIAGRAM_LIMITS.MAX_SERIES);
  if (!series) return undefined;
  if (!series.length) errors.add('series', 'at least one series is required');

  const out: any[] = [];
  series.forEach((entry, i) => {
    const at = `series[${i}]`;
    if (!isPlainObject(entry)) {
      errors.add(at, 'must be an object');
      return;
    }
    const pts = array(errors, `${at}.points`, entry.points, DIAGRAM_LIMITS.MAX_SERIES_POINTS);
    if (!pts) return;
    if (pts.length < 2) {
      errors.add(`${at}.points`, 'a line needs at least two points');
      return;
    }
    const coords: Array<{ x: number; y: number }> = [];
    pts.forEach((p, j) => {
      if (!isPlainObject(p)) {
        errors.add(`${at}.points[${j}]`, 'must be an object with x and y');
        return;
      }
      const x = num(errors, `${at}.points[${j}].x`, p.x);
      const y = num(errors, `${at}.points[${j}].y`, p.y);
      if (x !== undefined && y !== undefined) coords.push({ x, y });
    });
    if (coords.length !== pts.length) return;
    const item: any = { points: coords };
    if (entry.label !== undefined) {
      const text = label(errors, `${at}.label`, entry.label);
      if (text === undefined) return;
      item.label = text;
    }
    const style = optionalStroke(errors, `${at}.style`, entry.style);
    if (style) item.style = style;
    const markers = boolOrUndefined(entry.markers);
    if (markers !== undefined) item.markers = markers;
    out.push(item);
  });

  const spec: any = { kind: 'line_graph', series: out };
  for (const key of ['title', 'xLabel', 'yLabel'] as const) {
    if (raw[key] === undefined) continue;
    const max = key === 'title' ? DIAGRAM_LIMITS.MAX_TITLE_CHARS : DIAGRAM_LIMITS.MAX_LABEL_CHARS;
    const text = label(errors, key, raw[key], max);
    if (text !== undefined) spec[key] = text;
  }
  if (raw.xRange !== undefined) {
    const value = range(errors, 'xRange', raw.xRange);
    if (value) spec.xRange = value;
  }
  if (raw.yRange !== undefined) {
    const value = range(errors, 'yRange', raw.yRange);
    if (value) spec.yRange = value;
  }
  const grid = boolOrUndefined(raw.grid);
  if (grid !== undefined) spec.grid = grid;
  return spec;
}

// ── Physics ─────────────────────────────────────────────────────────────────

function validateRayDiagram(errors: Errors, raw: any): DiagramSpec | undefined {
  const device = enumValue(errors, 'device', raw.device, OPTICAL_DEVICES);
  const focalLength = num(errors, 'focalLength', raw.focalLength, { positive: true });
  const objectDistance = num(errors, 'objectDistance', raw.objectDistance, { positive: true });
  const objectHeight = num(errors, 'objectHeight', raw.objectHeight, { positive: true });
  if (device === undefined || focalLength === undefined
      || objectDistance === undefined || objectHeight === undefined) {
    return undefined;
  }
  // At exactly the focal point the rays emerge parallel and no image forms;
  // the construction is undefined rather than merely awkward to draw.
  if (Math.abs(objectDistance - focalLength) < 1e-9
      && (device === 'concave_mirror' || device === 'convex_lens')) {
    errors.add('objectDistance', 'an object at the focal point forms no image — choose a different distance');
    return undefined;
  }

  const spec: any = { kind: 'ray_diagram', device, focalLength, objectDistance, objectHeight };
  if (raw.title !== undefined) {
    const title = label(errors, 'title', raw.title, DIAGRAM_LIMITS.MAX_TITLE_CHARS);
    if (title !== undefined) spec.title = title;
  }
  const rays = boolOrUndefined(raw.showPrincipalRays);
  if (rays !== undefined) spec.showPrincipalRays = rays;
  const image = boolOrUndefined(raw.showImage);
  if (image !== undefined) spec.showImage = image;
  if (raw.labels !== undefined) {
    if (!isPlainObject(raw.labels)) {
      errors.add('labels', 'must be an object');
    } else {
      const labels: any = {};
      for (const key of ['object', 'image', 'focus', 'centre'] as const) {
        if (raw.labels[key] === undefined) continue;
        const text = label(errors, `labels.${key}`, raw.labels[key]);
        if (text !== undefined) labels[key] = text;
      }
      if (Object.keys(labels).length) spec.labels = labels;
    }
  }
  return spec;
}

function validateForceDiagram(errors: Errors, raw: any): DiagramSpec | undefined {
  if (!isPlainObject(raw.body)) {
    errors.add('body', 'is required');
    return undefined;
  }
  const shape = enumValue(errors, 'body.shape', raw.body.shape, ['block', 'circle'] as const);
  if (shape === undefined) return undefined;

  const body: any = { shape };
  if (raw.body.label !== undefined) {
    const text = label(errors, 'body.label', raw.body.label);
    if (text !== undefined) body.label = text;
  }

  const forces = array(errors, 'forces', raw.forces, DIAGRAM_LIMITS.MAX_FORCES);
  if (!forces) return undefined;
  if (!forces.length) errors.add('forces', 'at least one force is required');

  const out: any[] = [];
  forces.forEach((force, i) => {
    const at = `forces[${i}]`;
    if (!isPlainObject(force)) {
      errors.add(at, 'must be an object');
      return;
    }
    const magnitude = num(errors, `${at}.magnitude`, force.magnitude, { positive: true });
    const angleDeg = num(errors, `${at}.angleDeg`, force.angleDeg, { min: -360, max: 360 });
    if (magnitude === undefined || angleDeg === undefined) return;
    const entry: any = { magnitude, angleDeg };
    if (force.label !== undefined) {
      const text = label(errors, `${at}.label`, force.label);
      if (text === undefined) return;
      entry.label = text;
    }
    out.push(entry);
  });

  const spec: any = { kind: 'force_diagram', body, forces: out };
  if (raw.title !== undefined) {
    const title = label(errors, 'title', raw.title, DIAGRAM_LIMITS.MAX_TITLE_CHARS);
    if (title !== undefined) spec.title = title;
  }
  const resultant = boolOrUndefined(raw.showResultant);
  if (resultant !== undefined) spec.showResultant = resultant;
  return spec;
}

// ── Templates ───────────────────────────────────────────────────────────────

function validateTemplate(errors: Errors, raw: any): DiagramSpec | undefined {
  const template = enumValue(errors, 'template', raw.template, DIAGRAM_TEMPLATE_IDS);
  if (template === undefined) return undefined;

  const spec: any = { kind: 'template', template };
  if (raw.title !== undefined) {
    const title = label(errors, 'title', raw.title, DIAGRAM_LIMITS.MAX_TITLE_CHARS);
    if (title !== undefined) spec.title = title;
  }
  if (raw.labels !== undefined) {
    if (!isPlainObject(raw.labels)) {
      errors.add('labels', 'must be an object of slot -> label');
    } else {
      const entries = Object.entries(raw.labels);
      if (entries.length > DIAGRAM_LIMITS.MAX_TEMPLATE_LABELS) {
        errors.add('labels', `must contain at most ${DIAGRAM_LIMITS.MAX_TEMPLATE_LABELS} entries`);
      } else {
        const labels: Record<string, string> = {};
        for (const [slot, value] of entries) {
          const slotId = id(errors, `labels.${slot}`, slot);
          const text = label(errors, `labels.${slot}`, value);
          if (slotId !== undefined && text !== undefined) labels[slotId] = text;
        }
        if (Object.keys(labels).length) spec.labels = labels;
      }
    }
  }
  if (raw.hideLabels !== undefined) {
    const hidden = array(errors, 'hideLabels', raw.hideLabels, DIAGRAM_LIMITS.MAX_TEMPLATE_LABELS, false);
    if (hidden && hidden.length) {
      const slots: string[] = [];
      hidden.forEach((slot, i) => {
        const value = id(errors, `hideLabels[${i}]`, slot);
        if (value !== undefined) slots.push(value);
      });
      if (slots.length) spec.hideLabels = slots;
    }
  }
  return spec;
}

// ── Registry ────────────────────────────────────────────────────────────────

/**
 * Adding a diagram kind is one entry here plus its type. Nothing in the core
 * needs to know the shapes a particular kind uses.
 */
const VALIDATORS: Record<string, (errors: Errors, raw: any) => DiagramSpec | undefined> = {
  geometry: validateGeometry,
  cartesian: validateCartesian,
  bar_chart: validateBarChart,
  line_graph: validateLineGraph,
  ray_diagram: validateRayDiagram,
  force_diagram: validateForceDiagram,
  template: validateTemplate,
};

/**
 * Validate an untrusted diagram specification.
 *
 * On success the returned `spec` is a NEW object built only from recognised
 * fields — never the caller's object — so nothing unknown can reach storage or
 * the renderer. On failure every problem found is reported, not just the first.
 */
export function validateDiagramSpec(input: unknown): DiagramValidationResult {
  const errors = new Errors();

  if (!isPlainObject(input)) {
    return { valid: false, errors: ['spec: must be an object'] };
  }
  const raw = input as any;

  const kind = raw.kind;
  if (typeof kind !== 'string' || !DIAGRAM_KINDS.includes(kind as any)) {
    return {
      valid: false,
      errors: [`kind: unsupported diagram type "${String(kind)}" (supported: ${DIAGRAM_KINDS.join(', ')})`],
    };
  }

  const spec = VALIDATORS[kind](errors, raw);
  if (!errors.ok || !spec) {
    return { valid: false, errors: errors.list.length ? errors.list : ['spec: could not be validated'] };
  }
  return { valid: true, spec, errors: [] };
}
