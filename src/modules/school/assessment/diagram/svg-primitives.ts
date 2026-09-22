/**
 * SVG primitives — the only place in the engine that produces markup.
 *
 * SAFETY
 * Every element is built here from a fixed vocabulary. There is no code path
 * that concatenates caller-supplied markup, so the output cannot contain a
 * `<script>`, a `<foreignObject>`, an `on*` handler, an `href`, or a reference
 * to anything outside the document. Text and attribute values are escaped on
 * the way in without exception.
 *
 * Arrowheads are drawn as explicit polygons rather than with `<marker>`, which
 * would require `marker-end="url(#id)"`. A document containing no `url(` at
 * all is a far easier thing to assert about than one that contains some `url(`
 * references that happen to be internal — and the assertion is what a reviewer
 * actually checks.
 *
 * DETERMINISM
 * Numbers are formatted through `fmt`, which rounds to a fixed precision and
 * normalises negative zero. Nothing here reads the clock, the locale or a
 * random source, so the same specification produces byte-identical output.
 */

/** Decimal places kept in coordinates. Enough for 4-figure canvases. */
const PRECISION = 3;

/**
 * Format a number for markup.
 *
 * Rounds to a fixed precision so that two mathematically identical values that
 * differ in the last floating-point bit serialise the same way, and maps -0 to
 * 0 because `String(-0)` is "0" but `(-0).toFixed(3)` is "-0.000" — a
 * difference that would otherwise make output depend on the sign of zero.
 */
export function fmt(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const factor = 10 ** PRECISION;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/**
 * Escape text for an XML text node or attribute value.
 *
 * All five XML predefined entities, always — attributes and text share one
 * function so no call site can pick the weaker of the two by mistake. `'` is
 * written as `&#39;` rather than `&apos;`, which is not defined in HTML4 and
 * is mishandled by some older renderers.
 */
export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Attribute values, in insertion order so output is stable. */
export type Attrs = Record<string, string | number | undefined>;

function attrs(map: Attrs): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined) continue;
    const text = typeof value === 'number' ? fmt(value) : escapeXml(value);
    parts.push(`${key}="${text}"`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** Dash patterns for the three stroke styles the schema allows. */
export function dashArray(style?: 'solid' | 'dashed' | 'dotted'): string | undefined {
  if (style === 'dashed') return '6 4';
  if (style === 'dotted') return '1.5 3';
  return undefined;
}

export function line(x1: number, y1: number, x2: number, y2: number, extra: Attrs = {}): string {
  return `<line${attrs({ x1, y1, x2, y2, ...extra })}/>`;
}

export function circle(cx: number, cy: number, r: number, extra: Attrs = {}): string {
  return `<circle${attrs({ cx, cy, r, ...extra })}/>`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, extra: Attrs = {}): string {
  return `<ellipse${attrs({ cx, cy, rx, ry, ...extra })}/>`;
}

export function rect(x: number, y: number, width: number, height: number, extra: Attrs = {}): string {
  return `<rect${attrs({ x, y, width, height, ...extra })}/>`;
}

export function path(d: string, extra: Attrs = {}): string {
  return `<path${attrs({ d, ...extra })}/>`;
}

export function polygon(pts: Array<[number, number]>, extra: Attrs = {}): string {
  const points = pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
  return `<polygon${attrs({ points, ...extra })}/>`;
}

export function polyline(pts: Array<[number, number]>, extra: Attrs = {}): string {
  const points = pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
  return `<polyline${attrs({ points, fill: 'none', ...extra })}/>`;
}

/**
 * A text node. The content is escaped here and nowhere else, so a caller
 * cannot accidentally pass through raw markup.
 */
export function text(x: number, y: number, content: string, extra: Attrs = {}): string {
  return `<text${attrs({ x, y, ...extra })}>${escapeXml(content)}</text>`;
}

export function group(children: string[], extra: Attrs = {}): string {
  const inner = children.filter(Boolean).join('');
  return `<g${attrs(extra)}>${inner}</g>`;
}

/**
 * An arrowhead at (tipX, tipY) pointing along the direction (dx, dy).
 *
 * A filled polygon rather than a `<marker>` — see the module note.
 */
export function arrowHead(
  tipX: number, tipY: number, dx: number, dy: number,
  size: number, extra: Attrs = {},
): string {
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // Perpendicular, for the two back corners.
  const px = -uy;
  const py = ux;
  const backX = tipX - ux * size;
  const backY = tipY - uy * size;
  const half = size * 0.38;
  return polygon(
    [
      [tipX, tipY],
      [backX + px * half, backY + py * half],
      [backX - px * half, backY - py * half],
    ],
    { fill: 'currentColor', stroke: 'none', ...extra },
  );
}

/** Wrap rendered children in a complete, standalone SVG document. */
export function svgDocument(width: number, height: number, children: string[]): string {
  const inner = children.filter(Boolean).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}"`
    + ` width="${fmt(width)}" height="${fmt(height)}"`
    + ' preserveAspectRatio="xMidYMid meet"'
    // A neutral ink colour that both themes can read, set once so every child
    // can use currentColor rather than repeating a literal.
    + ' fill="none" stroke="#111827" color="#111827"'
    + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'
    + ' font-family="Georgia, \'Times New Roman\', serif" font-size="13">'
    + `<rect x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="#ffffff" stroke="none"/>`
    + inner
    + '</svg>'
  );
}

/**
 * Markup that must never appear in generated output.
 *
 * Used by the engine's own self-check and by tests. It is a belt-and-braces
 * assertion: the builders above cannot produce any of it, and this catches a
 * future change that breaks that property.
 */
export const FORBIDDEN_SVG_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'script element', re: /<\s*script/i },
  { name: 'foreignObject', re: /<\s*foreignObject/i },
  { name: 'event handler', re: /\son[a-z]+\s*=/i },
  { name: 'external or fragment url()', re: /url\s*\(/i },
  { name: 'href attribute', re: /\shref\s*=|xlink:href/i },
  { name: 'use element', re: /<\s*use[\s/>]/i },
  { name: 'image element', re: /<\s*image[\s/>]/i },
  { name: 'style element or attribute', re: /<\s*style|\sstyle\s*=/i },
  { name: 'javascript: scheme', re: /javascript\s*:/i },
  { name: 'data: scheme', re: /data\s*:/i },
  { name: 'entity declaration', re: /<!\s*(ENTITY|DOCTYPE)/i },
];

/**
 * The document's markup skeleton: element names and attributes, with every
 * text node removed.
 *
 * Text nodes are escaped on the way in and therefore cannot contain `<` or
 * `>`, so everything between a `>` and the next `<` is inert character data.
 * Stripping it is what lets the forbidden-pattern scan be precise: a label
 * that legitimately reads "set onchange = true" is text, not an event handler,
 * and scanning the raw document would reject it.
 */
export function markupSkeleton(svg: string): string {
  return String(svg).replace(/>[^<]*</g, '><');
}

/**
 * Throws if the generated markup contains anything forbidden.
 *
 * Checked against the skeleton, not the raw string — see markupSkeleton. The
 * builders in this module cannot emit any of these constructs; this is the
 * assertion that a future change has not quietly made them able to.
 */
export function assertSafeSvg(svg: string): void {
  const skeleton = markupSkeleton(svg);
  for (const { name, re } of FORBIDDEN_SVG_PATTERNS) {
    if (re.test(skeleton)) {
      throw new Error(`generated SVG contained a ${name}`);
    }
  }
}
