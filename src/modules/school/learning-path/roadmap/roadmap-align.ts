/**
 * Turning the AI's chapter roadmap into stored topics, and linking every one
 * of the school's recorded topics to the roadmap topic that covers it. Pure.
 */

export interface AiRoadmapTopic {
  topic: string;
  subtopics: string[];
  covers?: string[];
}

export interface CurriculumTopic {
  id: string;
  name: string;
}

export interface AlignedRoadmap {
  topics: { ord: number; name: string; subtopics: string[] }[];
  /** recorded (curriculum) topic id -> ord of the roadmap topic that covers it */
  links: Map<string, number>;
}

const MAX_TOPICS = 12;
const MAX_SUBTOPICS = 8;

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2));

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * Validated topics in the AI's order. A recorded topic is linked by the AI's
 * own "covers" first; one it did not place goes to the roadmap topic whose
 * name and subtopics share most of its words (at least half), else stays
 * unlinked and its marks count for the chapter as a whole.
 */
export function alignRoadmap(ai: AiRoadmapTopic[], recorded: CurriculumTopic[]): AlignedRoadmap {
  const topics: AlignedRoadmap['topics'] = [];
  const coversByOrd = new Map<number, string[]>();
  const seen = new Set<string>();
  for (const t of Array.isArray(ai) ? ai : []) {
    const name = String(t?.topic ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    const subtopics = [...new Set((Array.isArray(t.subtopics) ? t.subtopics : []).map((s) => String(s).trim()).filter(Boolean))].slice(
      0,
      MAX_SUBTOPICS,
    );
    const ord = topics.length + 1;
    topics.push({ ord, name, subtopics });
    coversByOrd.set(ord, Array.isArray(t.covers) ? t.covers.map(String) : []);
    if (topics.length >= MAX_TOPICS) break;
  }

  const links = new Map<string, number>();
  const byName = new Map(recorded.map((r) => [norm(r.name), r]));
  for (const [ord, covers] of coversByOrd) {
    for (const c of covers) {
      const r = byName.get(norm(c));
      if (r && !links.has(r.id)) links.set(r.id, ord);
    }
  }
  for (const r of recorded) {
    if (links.has(r.id)) continue;
    const rw = words(r.name);
    let best: { ord: number; score: number } | null = null;
    for (const t of topics) {
      const score = Math.max(overlap(rw, words(t.name)), overlap(rw, words(t.subtopics.join(' '))));
      if (score >= 0.5 && (!best || score > best.score)) best = { ord: t.ord, score };
    }
    if (best) links.set(r.id, best.ord);
  }
  return { topics, links };
}

export interface ExistingSubtopic {
  id: string;
  name: string;
}

export interface AlignedSubtopics {
  /** Every subtopic the DB should have active after this write, in the AI's order. */
  subtopics: { ord: number; name: string }[];
  /** ord -> an existing row's id to reuse (matched by normalized name); absent means brand new. */
  matches: Map<number, string>;
  /** Existing active ids the AI no longer returned. The caller marks these inactive, never deletes them. */
  retired: string[];
}

/**
 * Matches the AI's subtopic names for one topic against that topic's existing
 * active subtopic rows by normalized name, so a subtopic keeps its id (and
 * whatever thread or mastery points at it) across roadmap regenerations
 * instead of only ever matching by name. Simple exact-normalized matching is
 * enough here (subtopic names are short); a dropped subtopic is reported for
 * retirement, never deletion, since things may already point at it.
 */
export function alignSubtopics(aiSubtopics: string[], existing: ExistingSubtopic[]): AlignedSubtopics {
  const names = [...new Set((Array.isArray(aiSubtopics) ? aiSubtopics : []).map((s) => String(s).trim()).filter(Boolean))].slice(0, MAX_SUBTOPICS);
  const byNorm = new Map(existing.map((e) => [norm(e.name), e]));
  const used = new Set<string>();
  const subtopics: AlignedSubtopics['subtopics'] = [];
  const matches = new Map<number, string>();
  names.forEach((name, i) => {
    const ord = i + 1;
    subtopics.push({ ord, name });
    const hit = byNorm.get(norm(name));
    if (hit && !used.has(hit.id)) {
      matches.set(ord, hit.id);
      used.add(hit.id);
    }
  });
  const retired = existing.filter((e) => !used.has(e.id)).map((e) => e.id);
  return { subtopics, matches, retired };
}

/** After repeated AI failures: one topic, the chapter itself, covering every recorded topic. */
export function fallbackRoadmap(chapterName: string, recorded: CurriculumTopic[]): AlignedRoadmap {
  return {
    topics: [{ ord: 1, name: chapterName.trim().slice(0, 160), subtopics: [] }],
    links: new Map(recorded.map((r) => [r.id, 1])),
  };
}
