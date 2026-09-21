/**
 * Content addressing for rendered diagrams.
 *
 * A stored SVG is named by the hash of the thing that produced it — the
 * validated specification together with the renderer version. Two consequences
 * follow, and both are the point:
 *
 *   The same diagram is stored once. A question duplicated across two papers,
 *   or a specification pasted between them, points at one object rather than
 *   two identical copies.
 *
 *   A renderer change cannot serve a stale image. The version is part of the
 *   hash, so v2 of the renderer produces a different key for the same
 *   specification and the old object is simply never addressed again. Nothing
 *   has to be invalidated, because nothing is overwritten.
 *
 * Determinism is therefore load-bearing, not a nicety: if the hash moved
 * between runs, every re-render would orphan its predecessor.
 */
import { createHash } from 'crypto';
import { RENDERER_VERSION, type DiagramSpec } from './diagram-spec.types';

/**
 * JSON with object keys sorted, recursively.
 *
 * The validator already rebuilds specifications field by field in a fixed
 * order, so `JSON.stringify` alone would be stable today. Sorting makes the
 * hash independent of that — a future reordering of the validator's assignments
 * is an ordinary refactor, and it must not silently repoint every stored
 * object. Array order is preserved, because in a diagram it carries meaning:
 * the order of points and shapes is the order they are drawn.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((key) => (value as any)[key] !== undefined)
    .sort();
  return `{${entries
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`)
    .join(',')}}`;
}

/**
 * The content hash of a rendered diagram.
 *
 * Covers the specification AND the renderer version, so the identity of a
 * stored image is "this drawing, made by this renderer".
 */
export function diagramContentHash(
  spec: DiagramSpec,
  rendererVersion: string = RENDERER_VERSION,
): string {
  const payload = canonicalJson({ rendererVersion, spec });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Where a rendered diagram lives in object storage.
 *
 * Tenant-scoped like every other asset in this codebase, so a bucket listing
 * is readable and a tenant's objects are contiguous. The renderer version is a
 * path segment as well as part of the hash: the hash alone would keep versions
 * apart, but a visible segment makes it possible to see — or sweep — one
 * renderer generation without decoding anything.
 */
export function diagramStorageKey(
  instituteId: string,
  hash: string,
  rendererVersion: string = RENDERER_VERSION,
): string {
  return `tenants/${instituteId}/assessment-diagrams/${rendererVersion}/${hash}.svg`;
}
