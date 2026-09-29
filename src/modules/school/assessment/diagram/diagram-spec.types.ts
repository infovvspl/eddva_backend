/**
 * Diagram specification — the contract between the model and the renderer.
 *
 * WHY A SPEC AND NOT SVG
 * A model asked for a picture will happily return SVG markup, and SVG is a
 * scripting host: `<script>`, `<foreignObject>`, `on*` handlers, `xlink:href`,
 * external `<use>`, CSS `url()`. Accepting markup would mean sanitising a
 * hostile document on every question paper. Accepting a SPEC instead means the
 * only thing that ever reaches the page is markup this repository wrote.
 *
 * The strongest guarantee here is structural, not procedural:
 *
 *   THERE IS NO FIELD IN THIS SCHEMA THAT CAN HOLD A URL, A STYLE, A SCRIPT,
 *   MARKUP, OR A FILE REFERENCE.
 *
 * Every string is either an identifier matched against a fixed pattern, a
 * short human label, or a value from a closed enum. An attacker controlling
 * the model output cannot express an external resource, because the vocabulary
 * has no way to say one.
 *
 * The same reasoning drives plotted functions: there is no expression string
 * and therefore no expression parser and no eval. A curve is named from a
 * closed set of forms and carries coefficients.
 *
 * EXTENSIBILITY
 * Diagram kinds are a discriminated union on `kind`, and the validator is a
 * registry keyed by that discriminant. Adding a kind is one type here plus one
 * validator entry — no change to the core.
 *
 * Phase 2 covers structure and numeric sanity. Deriving coordinates from
 * mathematical constraints, and verifying that a construction is actually
 * consistent (a point really lies on its circle, a perpendicular really is
 * perpendicular), is Phase 4.
 */

// ── Shared limits ───────────────────────────────────────────────────────────
// Caps exist so that one malformed specification cannot produce a document
// that takes unbounded time to render or unbounded space to store. Every one
// of them rejects; none silently truncates, because a silently truncated
// diagram is a wrong diagram on an exam paper.

export const DIAGRAM_LIMITS = {
  /** Coordinates live in an abstract user space the renderer maps to a viewBox. */
  COORD_MIN: -10_000,
  COORD_MAX: 10_000,
  MAX_POINTS: 40,
  MAX_SHAPES: 40,
  MAX_ANNOTATIONS: 20,
  MAX_LABEL_CHARS: 48,
  MAX_TITLE_CHARS: 120,
  MAX_POLYGON_VERTICES: 12,
  MAX_SERIES: 4,
  MAX_SERIES_POINTS: 60,
  MAX_CATEGORIES: 16,
  MAX_FORCES: 8,
  MAX_TEMPLATE_LABELS: 20,
  MAX_FUNCTIONS: 4,
  MAX_COEFFICIENTS: 6,
  /** Identifiers end up in generated markup, so they are deliberately narrow. */
  ID_PATTERN: /^[A-Za-z][A-Za-z0-9_']{0,15}$/,
} as const;

/** Where a label sits relative to its anchor. A closed set, never free text. */
export type LabelPosition =
  | 'above' | 'below' | 'left' | 'right'
  | 'above-left' | 'above-right' | 'below-left' | 'below-right';

export const LABEL_POSITIONS: readonly LabelPosition[] = [
  'above', 'below', 'left', 'right',
  'above-left', 'above-right', 'below-left', 'below-right',
];

/** Line treatments the renderer knows how to draw. No CSS anywhere. */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export const STROKE_STYLES: readonly StrokeStyle[] = ['solid', 'dashed', 'dotted'];

/** Arrowheads are structural, not decorative: they carry meaning in physics. */
export type ArrowStyle = 'none' | 'end' | 'both';
export const ARROW_STYLES: readonly ArrowStyle[] = ['none', 'end', 'both'];

/** A declared point, referenced elsewhere by id. */
export interface SpecPoint {
  id: string;
  x: number;
  y: number;
  /** Printed next to the point. Absent means the point is drawn unlabelled. */
  label?: string;
  labelPosition?: LabelPosition;
  /** false draws nothing at the coordinate but keeps it referenceable. */
  visible?: boolean;
}

/** A free-standing measurement or note attached to a segment or point. */
export interface SpecAnnotation {
  /** Two ids = midpoint of that segment; one id = beside that point. */
  anchor: string[];
  text: string;
  position?: LabelPosition;
}

// ── Geometry ────────────────────────────────────────────────────────────────

export type GeometryShape =
  | { type: 'circle'; id?: string; center: string; radius: number; style?: StrokeStyle }
  | { type: 'segment'; from: string; to: string; style?: StrokeStyle; arrow?: ArrowStyle; measure?: string }
  | { type: 'polygon'; vertices: string[]; style?: StrokeStyle }
  | { type: 'chord'; circle: string; from: string; to: string; style?: StrokeStyle; measure?: string }
  | { type: 'diameter'; circle: string; from: string; to: string; style?: StrokeStyle; measure?: string }
  | { type: 'radius'; circle: string; to: string; style?: StrokeStyle; measure?: string }
  | { type: 'tangent'; circle: string; at: string; length: number; style?: StrokeStyle }
  | { type: 'secant'; circle: string; from: string; to: string; style?: StrokeStyle }
  | { type: 'perpendicular'; from: string; segment: [string, string]; foot?: string; style?: StrokeStyle }
  | { type: 'angle'; at: string; from: string; to: string; label?: string; rightAngle?: boolean };

export const GEOMETRY_SHAPE_TYPES = [
  'circle', 'segment', 'polygon', 'chord', 'diameter',
  'radius', 'tangent', 'secant', 'perpendicular', 'angle',
] as const;

export interface GeometrySpec {
  kind: 'geometry';
  title?: string;
  points: SpecPoint[];
  shapes: GeometryShape[];
  annotations?: SpecAnnotation[];
}

// ── Mathematics ─────────────────────────────────────────────────────────────

/**
 * Curve forms, as a closed set with coefficients.
 *
 * Deliberately NOT an expression string: a string would need a parser, a
 * parser is an evaluator, and an evaluator on model output is a sandbox
 * escape waiting to happen. `linear` is [m, c]; `quadratic` [a, b, c];
 * `cubic` [a, b, c, d]; `sine`/`cosine` [amplitude, frequency, phase];
 * `exponential` [a, b] for a·bˣ; `reciprocal` [k] for k/x.
 */
export type FunctionForm =
  | 'linear' | 'quadratic' | 'cubic'
  | 'sine' | 'cosine' | 'exponential' | 'reciprocal';

export const FUNCTION_FORMS: readonly FunctionForm[] = [
  'linear', 'quadratic', 'cubic', 'sine', 'cosine', 'exponential', 'reciprocal',
];

/** How many coefficients each form requires — exact, not a minimum. */
export const FUNCTION_ARITY: Readonly<Record<FunctionForm, number>> = {
  linear: 2, quadratic: 3, cubic: 4, sine: 3, cosine: 3, exponential: 2, reciprocal: 1,
};

export interface SpecFunction {
  form: FunctionForm;
  coefficients: number[];
  domain?: [number, number];
  label?: string;
  style?: StrokeStyle;
}

export interface CartesianSpec {
  kind: 'cartesian';
  title?: string;
  xRange: [number, number];
  yRange: [number, number];
  xLabel?: string;
  yLabel?: string;
  grid?: boolean;
  points?: SpecPoint[];
  functions?: SpecFunction[];
  /** A straight line through two declared points — the school "graph of" case. */
  lines?: Array<{ from: string; to: string; label?: string; style?: StrokeStyle; extend?: boolean }>;
  annotations?: SpecAnnotation[];
}

export interface BarChartSpec {
  kind: 'bar_chart';
  title?: string;
  categories: string[];
  values: number[];
  xLabel?: string;
  yLabel?: string;
  /** Omitted means the renderer derives a sensible axis from the values. */
  yMax?: number;
  showValues?: boolean;
}

export interface LineGraphSpec {
  kind: 'line_graph';
  title?: string;
  xLabel?: string;
  yLabel?: string;
  series: Array<{
    label?: string;
    points: Array<{ x: number; y: number }>;
    style?: StrokeStyle;
    markers?: boolean;
  }>;
  xRange?: [number, number];
  yRange?: [number, number];
  grid?: boolean;
}

// ── Physics ─────────────────────────────────────────────────────────────────

export type OpticalDevice =
  | 'concave_mirror' | 'convex_mirror' | 'convex_lens' | 'concave_lens';

export const OPTICAL_DEVICES: readonly OpticalDevice[] = [
  'concave_mirror', 'convex_mirror', 'convex_lens', 'concave_lens',
];

/**
 * A ray diagram is described by its PHYSICS, not by its lines.
 *
 * The renderer computes the image position and the ray paths from the mirror
 * or lens equation, so the drawing cannot disagree with the optics — which is
 * exactly the failure a model drawing rays by eye produces.
 */
export interface RayDiagramSpec {
  kind: 'ray_diagram';
  title?: string;
  device: OpticalDevice;
  /** Always positive here; sign conventions are the renderer's business. */
  focalLength: number;
  objectDistance: number;
  objectHeight: number;
  showPrincipalRays?: boolean;
  showImage?: boolean;
  labels?: { object?: string; image?: string; focus?: string; centre?: string };
}

export interface ForceDiagramSpec {
  kind: 'force_diagram';
  title?: string;
  body: { shape: 'block' | 'circle'; label?: string };
  forces: Array<{
    label?: string;
    magnitude: number;
    /** Degrees anticlockwise from the positive x-axis. */
    angleDeg: number;
  }>;
  showResultant?: boolean;
}

// ── Template-backed diagrams ────────────────────────────────────────────────

/**
 * Diagrams whose artwork is fixed and whose only variable is the labelling —
 * biology cells and school-level series circuits.
 *
 * A closed registry of template ids, never a path or a URL: the renderer holds
 * the geometry, and a specification can only choose one of them and rename its
 * labelled slots. This is the "reusable scientific diagram template" case.
 */
export type DiagramTemplateId =
  | 'plant_cell' | 'animal_cell' | 'neuron' | 'bacterial_cell'
  | 'series_circuit' | 'parallel_circuit';

export const DIAGRAM_TEMPLATE_IDS: readonly DiagramTemplateId[] = [
  'plant_cell', 'animal_cell', 'neuron', 'bacterial_cell',
  'series_circuit', 'parallel_circuit',
];

export interface TemplateSpec {
  kind: 'template';
  title?: string;
  template: DiagramTemplateId;
  /** Slot id -> replacement label. Unknown slots are rejected by the renderer. */
  labels?: Record<string, string>;
  /** Hide a slot's label, e.g. to turn a diagram into a labelling exercise. */
  hideLabels?: string[];
}

// ── The union ───────────────────────────────────────────────────────────────

export type DiagramSpec =
  | GeometrySpec
  | CartesianSpec
  | BarChartSpec
  | LineGraphSpec
  | RayDiagramSpec
  | ForceDiagramSpec
  | TemplateSpec;

export type DiagramKind = DiagramSpec['kind'];

export const DIAGRAM_KINDS: readonly DiagramKind[] = [
  'geometry', 'cartesian', 'bar_chart', 'line_graph',
  'ray_diagram', 'force_diagram', 'template',
];

/**
 * Bumped whenever rendering output changes for an unchanged specification.
 * Part of the storage key, so a renderer upgrade cannot serve a stale image.
 */
export const RENDERER_VERSION = 'v1';
