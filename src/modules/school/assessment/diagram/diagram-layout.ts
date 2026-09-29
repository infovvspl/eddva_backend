/**
 * Layout — the single place where specification space becomes screen space.
 *
 * Specification coordinates are mathematical: y increases upward, units are
 * whatever the question uses (metres, seconds, marks). Screen coordinates are
 * pixels with y increasing downward. Converting in exactly one place means no
 * renderer has to remember which way up it is, and no diagram can end up
 * mirrored because one shape forgot to flip.
 *
 * ASPECT RATIO IS ALWAYS PRESERVED. A single scale factor is used for both
 * axes, so a circle is a circle and a right angle looks like one. A diagram
 * that does not fill its box is centred rather than stretched — stretching
 * would turn a square into a rectangle and a 10 m radius into an ellipse.
 */
import type { Bounds, Vec } from './diagram-geometry';
import type { LabelPosition } from './diagram-spec.types';

export interface CanvasOptions {
  width?: number;
  height?: number;
  margin?: number;
}

export const DEFAULT_CANVAS = {
  WIDTH: 560,
  HEIGHT: 420,
  MARGIN: 34,
} as const;

export interface Transform {
  width: number;
  height: number;
  margin: number;
  /** Pixels per specification unit — the same on both axes, by design. */
  scale: number;
  /** Map a specification point to screen pixels. */
  toScreen: (p: Vec) => Vec;
  /** Map a length; only meaningful because the scale is uniform. */
  toScreenLength: (v: number) => number;
}

/**
 * Build the transform that fits `bounds` inside the canvas.
 *
 * A degenerate span (every point on one line, or a single point) is widened to
 * a unit box rather than producing an infinite scale.
 */
export function createTransform(bounds: Bounds, options: CanvasOptions = {}): Transform {
  const width = clampPositive(options.width, DEFAULT_CANVAS.WIDTH);
  const height = clampPositive(options.height, DEFAULT_CANVAS.HEIGHT);
  const margin = Math.max(0, options.margin ?? DEFAULT_CANVAS.MARGIN);

  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-9);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-9);
  const usableWidth = Math.max(width - margin * 2, 1);
  const usableHeight = Math.max(height - margin * 2, 1);

  const scale = Math.min(usableWidth / spanX, usableHeight / spanY);

  // Centre whatever is left over, so a wide diagram sits in the middle of a
  // tall box instead of against its top edge.
  const drawnWidth = spanX * scale;
  const drawnHeight = spanY * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;

  const toScreen = (p: Vec): Vec => ({
    x: offsetX + (p.x - bounds.minX) * scale,
    // The one y flip in the engine.
    y: offsetY + (bounds.maxY - p.y) * scale,
  });

  return {
    width,
    height,
    margin,
    scale,
    toScreen,
    toScreenLength: (v: number) => v * scale,
  };
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  // Bounded so a specification cannot request a canvas that costs megabytes to
  // store or seconds to rasterise in a PDF.
  return Math.min(Math.max(Math.round(value), 120), 2000);
}

/** Text anchoring for a label placed relative to its point. */
export interface LabelPlacement {
  dx: number;
  dy: number;
  anchor: 'start' | 'middle' | 'end';
  baseline: 'auto' | 'middle' | 'hanging';
}

/**
 * Where a label sits relative to its anchor, in screen pixels.
 *
 * `offset` is the gap from the point, which callers widen for a labelled dot so
 * the text clears the marker. The eight positions are the schema's closed set,
 * so there is nothing to validate here — an unknown value cannot arrive.
 */
export function placeLabel(position: LabelPosition | undefined, offset = 9): LabelPlacement {
  const diagonal = offset * 0.72;
  switch (position) {
    case 'above':
      return { dx: 0, dy: -offset, anchor: 'middle', baseline: 'auto' };
    case 'below':
      return { dx: 0, dy: offset + 4, anchor: 'middle', baseline: 'hanging' };
    case 'left':
      return { dx: -offset, dy: 0, anchor: 'end', baseline: 'middle' };
    case 'right':
      return { dx: offset, dy: 0, anchor: 'start', baseline: 'middle' };
    case 'above-left':
      return { dx: -diagonal, dy: -diagonal, anchor: 'end', baseline: 'auto' };
    case 'above-right':
      return { dx: diagonal, dy: -diagonal, anchor: 'start', baseline: 'auto' };
    case 'below-left':
      return { dx: -diagonal, dy: diagonal + 4, anchor: 'end', baseline: 'hanging' };
    case 'below-right':
      return { dx: diagonal, dy: diagonal + 4, anchor: 'start', baseline: 'hanging' };
    default:
      // Unspecified goes above-right: it is the quadrant least likely to collide
      // with the axes or the shape a point usually sits on.
      return { dx: diagonal, dy: -diagonal, anchor: 'start', baseline: 'auto' };
  }
}

/**
 * Choose a label position that points away from a reference point.
 *
 * Used for the vertices of a closed shape, where "outward from the centre" is
 * almost always the readable choice and is cheaper — and far more predictable —
 * than a collision solver.
 */
export function outwardPosition(point: Vec, reference: Vec): LabelPosition {
  const dx = point.x - reference.x;
  const dy = point.y - reference.y;
  const horizontal = Math.abs(dx) > Math.abs(dy) * 0.45;
  const vertical = Math.abs(dy) > Math.abs(dx) * 0.45;
  if (horizontal && vertical) {
    if (dy >= 0) return dx >= 0 ? 'above-right' : 'above-left';
    return dx >= 0 ? 'below-right' : 'below-left';
  }
  if (horizontal) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'above' : 'below';
}
