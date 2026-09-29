/**
 * Diagram anchoring for question papers — the pure half.
 *
 * WHY MARKERS LIVE IN THE MARKDOWN
 * `questions_json` is DERIVED, not authored. It is overwritten by `update()`
 * after every teacher edit, and `hydrateQuestions()` rewrites it during a plain
 * read whenever the parsed questions look stale. Anything stored only there can
 * be destroyed by a GET, so a diagram cannot be anchored to it.
 *
 * `content_text` is the only durable authored artifact, so the anchor lives
 * there as an explicit `[DIAGRAM: a3f91c04]` marker, and the association
 * between a diagram and a question is DERIVED from where that marker sits —
 * never stored. There is therefore no (question -> diagram) mapping that can go
 * stale when questions are edited, reordered or renumbered, which is what makes
 * re-parsing safe by construction rather than by care.
 *
 * The marker sits on its own line immediately after its question, the same
 * convention `[FIGURE: Fn]` and `[PLOT: ...]` already use, so a teacher learns
 * one rule rather than three. Unlike those two it PERSISTS: they are resolved
 * to images during generation and never stored, whereas this one is the handle
 * a teacher re-opens the diagram with.
 *
 * This module is deliberately free of NestJS, the database and R2 so the
 * anchoring rules can be tested as pure functions. The service owns the rows.
 */

/**
 * `[DIAGRAM: a3f91c04]`. Tolerant of spacing and case because papers are edited
 * by hand and pasted between documents; a marker that failed to match would be
 * printed to a student verbatim.
 */
export const DIAGRAM_MARKER_RE = /\[\s*DIAGRAM\s*:\s*([A-Za-z0-9]{4,16})\s*\]/gi;

/** Length of a generated marker key, in hex characters. */
const MARKER_KEY_LENGTH = 8;

/**
 * A marker occurrence, in document order.
 * `start`/`end` are offsets into the source text, so an individual occurrence
 * can be rewritten without disturbing the others.
 */
export interface DiagramMarker {
  key: string;
  start: number;
  end: number;
}

/** What a read path needs in order to turn a marker back into an image. */
export interface DiagramDisplay {
  url?: string | null;
  alt?: string | null;
  approved?: boolean;
}

/**
 * Every diagram marker in a paper, in the order they appear.
 *
 * Case is normalised on the key so `[DIAGRAM: A3F9]` and `[diagram:a3f9]`
 * resolve to the same row — a teacher retyping a marker should not create a
 * silent mismatch.
 */
export function extractDiagramMarkers(text: string): DiagramMarker[] {
  const source = String(text || '');
  if (!source) return [];
  const out: DiagramMarker[] = [];
  // A fresh regex per call: the module-level one carries /g state, and sharing
  // it across calls would make results depend on call order.
  const re = new RegExp(DIAGRAM_MARKER_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    out.push({
      key: String(match[1]).toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return out;
}

/** True when a paper mentions no diagram at all — the fast path. */
export function hasDiagramMarkers(text: string): boolean {
  return extractDiagramMarkers(text).length > 0;
}

/**
 * Rewrite exactly one occurrence, leaving every other one untouched.
 *
 * Needed because a duplicated or pasted marker is re-keyed in place: replacing
 * by string value would rewrite all the copies and defeat the point.
 */
export function replaceMarkerAt(
  text: string,
  marker: DiagramMarker,
  newKey: string,
): string {
  const source = String(text || '');
  return source.slice(0, marker.start) + `[DIAGRAM: ${newKey}]` + source.slice(marker.end);
}

/**
 * Delete one occurrence outright.
 *
 * Distinct from replaceMarkerAt with an empty key, which would leave the
 * literal text `[DIAGRAM: ]` in the paper — visible to a student, which is the
 * one thing a marker must never be.
 */
export function removeMarkerAt(text: string, marker: DiagramMarker): string {
  const source = String(text || '');
  return (source.slice(0, marker.start) + source.slice(marker.end))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Turn markers into Markdown images for display.
 *
 * `content_text` stores the marker; readers get the picture. A key with no
 * entry — or one whose diagram has no rendered image yet, or is not approved —
 * is REMOVED rather than shown, for the same reason an invented `[FIGURE: F9]`
 * is removed: a marker must never reach a student.
 */
export function expandDiagramMarkers(
  text: string,
  diagrams: Record<string, DiagramDisplay>,
  options: { includeUnapproved?: boolean } = {},
): string {
  const source = String(text || '');
  if (!source) return source;
  const re = new RegExp(DIAGRAM_MARKER_RE.source, 'gi');
  const expanded = source.replace(re, (_whole, rawKey: string) => {
    const diagram = diagrams?.[String(rawKey).toLowerCase()];
    if (!diagram || !diagram.url) return '';
    if (!diagram.approved && !options.includeUnapproved) return '';
    // Brackets are stripped from alt text so a caption can never terminate the
    // Markdown link early.
    const alt = String(diagram.alt || 'Diagram').replace(/[\[\]]/g, '').trim() || 'Diagram';
    return `\n\n![${alt}](${diagram.url})\n\n`;
  });
  return expanded.replace(/\n{3,}/g, '\n\n');
}

/** Remove every diagram marker, resolved or not. */
export function stripDiagramMarkers(text: string): string {
  const re = new RegExp(DIAGRAM_MARKER_RE.source, 'gi');
  return String(text || '').replace(re, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * A new marker key.
 *
 * Keys are unique per INSTITUTE, not per assessment, so that a marker pasted
 * from another paper resolves to exactly one source diagram and can be copied
 * rather than discarded. 8 hex characters is a 4.3-billion space against a few
 * thousand diagrams; the caller retries on the unique-index violation, which is
 * the only correct way to settle a collision race anyway.
 *
 * `crypto.randomUUID()` rather than Math.random: these end up in stored
 * documents, and a predictable key would let one paper's marker be guessed from
 * another's.
 */
export function generateMarkerKey(): string {
  const { randomUUID } = require('crypto') as typeof import('crypto');
  return randomUUID().replace(/-/g, '').slice(0, MARKER_KEY_LENGTH).toLowerCase();
}
