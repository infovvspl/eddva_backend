/**
 * Chapter lesson plan, schema v2: the typed structure the AI returns as JSON
 * (prompt `lesson_plan` in ai_services/views/bridge.py — keep the two in step),
 * its deterministic validation, and the legacy text rendering kept for v1
 * readers.
 *
 * Validation proves structure and internal consistency only (period count,
 * numbering, minutes, objective <-> question links, cited pages exist in the
 * source the model was given). It cannot prove a plan is factually or
 * pedagogically right: that is what the teacher's review and the admin's
 * approval are for.
 *
 * Timing: every teaching step has a whole number of minutes, at least 1, and a
 * period's steps add up to exactly the period length. The one exception is an
 * explicit closing marker, `{"phase": "conclusion", "marker": true, "minutes": 0}`
 * as the LAST step: a non-instructional note ("period ends; next: Henry's law")
 * that takes no class time. Without `marker: true` a zero-minute step is an
 * error: a conclusion that summarises the lesson is teaching and needs time.
 * Nothing is rounded or bumped: a fractional or zero duration is reported, not fixed.
 *
 * Grounding: warnings come from evidence (which pages the model was given, which
 * it cited, which claims cite nothing), never from the model's own description
 * of its coverage. `groundingNotes` is kept as the model's note, unverified.
 */

export const SCHEMA_VERSION = 2;

export const BLOOM_LEVELS = ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'] as const;
export type BloomLevel = typeof BLOOM_LEVELS[number];

export const PHASES = ['introduction', 'explanation', 'guided_practice', 'independent_practice', 'check', 'conclusion'] as const;
export type Phase = typeof PHASES[number];

export const PHASE_LABELS: Record<Phase, string> = {
  introduction: 'Introduction',
  explanation: 'Explanation',
  guided_practice: 'Guided practice',
  independent_practice: 'Independent practice',
  check: 'Check for understanding',
  conclusion: 'Conclusion',
};

export interface Objective {
  id: string;
  text: string;
  bloom: BloomLevel;
  assessment: string;
  source: { type: 'textbook' | 'suggestion'; pages: number[] };
}

export interface SequenceStep {
  phase: Phase;
  minutes: number;
  teacher: string;
  students: string;
  /** Untimed closing note (conclusion only, last step, 0 minutes). See the header. */
  marker?: true;
}
export interface Question { question: string; answer: string; objectiveIds: string[] }

export interface Period {
  number: number;
  topic: string;
  objectiveIds: string[];
  sequence: SequenceStep[];
  examples: string[];
  resources: string[];
  checks: string[];
  questions: Question[];
  homework: string;
  exitTicket: string;
  pages: number[];
}

export interface LessonPlanContent {
  schemaVersion: 2;
  title: string;
  objectives: Objective[];
  outcomes: string[];
  prerequisites: string[];
  keyConcepts: Array<{ term: string; meaning: string; pages: number[] }>;
  resources: string[];
  misconceptions: Array<{ misconception: string; correction: string }>;
  differentiation: { support: string[]; onLevel: string[]; challenge: string[]; accessibility: string[] };
  groundingNotes: string;
  periods: Period[];
}

export interface ValidationContext {
  /** Requested period count (generation); undefined when editing, where the teacher decides. */
  expectedPeriods?: number;
  /** Minutes per period the sequences must add up to. */
  minutesPerPeriod: number;
  /** Pages the model was actually given; cited pages outside this set are removed. Empty = ungrounded. */
  allowedPages: Set<number>;
  /** Set when the AI service had to leave passages out to fit the prompt. */
  sourceTruncated?: { used: number; available: number };
}

export interface QualityIssue { code: string; message: string; period?: number }

export interface ValidationResult {
  content: LessonPlanContent | null;
  /** Problems that make the plan unusable or inconsistent: never saved as a valid plan. */
  errors: QualityIssue[];
  /** Problems the teacher must see, but which don't block a draft. */
  warnings: QualityIssue[];
}

// ── parsing helpers ───────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};
/** A duration as given: a finite number (not rounded), or NaN when missing or not a number. */
const minutesOf = (v: unknown): number =>
  (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const pageList = (v: unknown): number[] => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v])
  .map(int).filter((n): n is number => n !== null && n > 0);

/** The first complete JSON object in a model's reply (fences and stray prose around it are ignored). */
export function extractJson(raw: string): unknown {
  const text = String(raw || '').replace(/^﻿/, '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The reply contains no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Any JSON value in a model's reply — an object or an array (a section rewrite
 * returns e.g. the misconceptions array). The whole reply is tried first, then
 * the span from the first '{' or '[' to the last matching closer.
 */
export function extractJsonValue(raw: string): unknown {
  const text = String(raw || '').replace(/^﻿/, '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(text); } catch { /* fall through */ }
  const brace = text.indexOf('{');
  const bracket = text.indexOf('[');
  const isArray = bracket >= 0 && (brace < 0 || bracket < brace);
  const start = isArray ? bracket : brace;
  const end = text.lastIndexOf(isArray ? ']' : '}');
  if (start < 0 || end <= start) throw new Error('The reply contains no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

const phaseOf = (v: unknown): Phase | null => {
  const s = str(v).toLowerCase().replace(/[\s-]+/g, '_');
  if ((PHASES as readonly string[]).includes(s)) return s as Phase;
  if (s.startsWith('intro') || s.includes('warm') || s.includes('recall')) return 'introduction';
  if (s.includes('guided')) return 'guided_practice';
  if (s.includes('independent') || s.includes('practice')) return 'independent_practice';
  if (s.includes('check') || s.includes('assess') || s.includes('exit')) return 'check';
  if (s.includes('conclu') || s.includes('summary') || s.includes('wrap') || s.includes('closure')) return 'conclusion';
  if (s.includes('explan') || s.includes('teach') || s.includes('instruct') || s.includes('develop')) return 'explanation';
  return null;
};

const bloomOf = (v: unknown): BloomLevel | null => {
  const s = str(v).toLowerCase().replace('analyze', 'analyse');
  return (BLOOM_LEVELS.find((b) => b.toLowerCase() === s) as BloomLevel) ?? null;
};

/** Coerces loosely typed JSON into the v2 shape; returns issues for anything it had to drop. */
function normalise(raw: any, issues: QualityIssue[]): LessonPlanContent {
  const objectives: Objective[] = (Array.isArray(raw?.objectives) ? raw.objectives : []).map((o: any, i: number) => {
    const bloom = bloomOf(o?.bloom);
    if (!bloom && str(o?.bloom)) issues.push({ code: 'bloom_unknown', message: `Objective ${i + 1}: "${str(o.bloom)}" is not a Bloom level` });
    return {
      id: str(o?.id) || `O${i + 1}`,
      text: str(o?.text),
      bloom: bloom ?? ('Understand' as BloomLevel),
      assessment: str(o?.assessment),
      source: { type: str(o?.source?.type) === 'textbook' ? 'textbook' : 'suggestion', pages: pageList(o?.source?.pages) },
    };
  });
  const periods: Period[] = (Array.isArray(raw?.periods) ? raw.periods : []).map((p: any, i: number) => ({
    number: int(p?.number) ?? i + 1,
    topic: str(p?.topic),
    objectiveIds: strList(p?.objectiveIds),
    sequence: (Array.isArray(p?.sequence) ? p.sequence : []).map((s: any) => {
      const phase = phaseOf(s?.phase);
      if (!phase) issues.push({ code: 'phase_unknown', message: `Period ${i + 1}: unknown step "${str(s?.phase)}"`, period: i + 1 });
      const step: SequenceStep = { phase: phase ?? 'explanation', minutes: minutesOf(s?.minutes), teacher: str(s?.teacher), students: str(s?.students) };
      if (s?.marker === true) step.marker = true;
      return step;
    }),
    examples: strList(p?.examples),
    resources: strList(p?.resources),
    checks: strList(p?.checks),
    questions: (Array.isArray(p?.questions) ? p.questions : []).map((q: any) => ({
      question: str(q?.question), answer: str(q?.answer), objectiveIds: strList(q?.objectiveIds),
    })),
    homework: str(p?.homework),
    exitTicket: str(p?.exitTicket),
    pages: pageList(p?.pages),
  }));
  const d = raw?.differentiation || {};
  return {
    schemaVersion: 2,
    title: str(raw?.title),
    objectives,
    outcomes: strList(raw?.outcomes),
    prerequisites: strList(raw?.prerequisites),
    keyConcepts: (Array.isArray(raw?.keyConcepts) ? raw.keyConcepts : [])
      .map((k: any) => ({ term: str(k?.term), meaning: str(k?.meaning), pages: pageList(k?.pages) }))
      .filter((k: any) => k.term),
    resources: strList(raw?.resources),
    misconceptions: (Array.isArray(raw?.misconceptions) ? raw.misconceptions : [])
      .map((m: any) => ({ misconception: str(m?.misconception), correction: str(m?.correction) }))
      .filter((m: any) => m.misconception),
    differentiation: { support: strList(d.support), onLevel: strList(d.onLevel), challenge: strList(d.challenge), accessibility: strList(d.accessibility) },
    groundingNotes: str(raw?.groundingNotes),
    periods,
  };
}

// ── validation ────────────────────────────────────────────────────────────────

/**
 * Parses (when given text) and validates a plan. `errors` empty means it is
 * structurally sound; `warnings` are shown to the teacher and admin.
 */
export function validateLessonPlan(input: string | unknown, ctx: ValidationContext): ValidationResult {
  const errors: QualityIssue[] = [];
  const warnings: QualityIssue[] = [];
  let raw: unknown;
  try {
    raw = typeof input === 'string' ? extractJson(input) : input;
  } catch (e) {
    return { content: null, errors: [{ code: 'not_json', message: `The reply is not valid JSON: ${(e as Error).message}` }], warnings };
  }
  if (!raw || typeof raw !== 'object') return { content: null, errors: [{ code: 'not_object', message: 'The plan is not an object' }], warnings };

  const content = normalise(raw, warnings);
  const objIds = new Set(content.objectives.map((o) => o.id));

  // Plan level
  if (!content.objectives.length) errors.push({ code: 'no_objectives', message: 'The plan has no learning objectives' });
  if (objIds.size !== content.objectives.length) errors.push({ code: 'duplicate_objective_ids', message: 'Two objectives share an id' });
  content.objectives.forEach((o) => {
    if (!o.text) errors.push({ code: 'objective_empty', message: `Objective ${o.id} has no text` });
    if (!o.assessment) errors.push({ code: 'objective_no_assessment', message: `Objective ${o.id} has no assessment method` });
  });
  if (!content.periods.length) errors.push({ code: 'no_periods', message: 'The plan has no periods' });
  if (ctx.expectedPeriods && content.periods.length && content.periods.length !== ctx.expectedPeriods) {
    errors.push({ code: 'period_count', message: `Expected ${ctx.expectedPeriods} periods, got ${content.periods.length}` });
  }
  content.periods.forEach((p, i) => {
    if (p.number !== i + 1) errors.push({ code: 'period_numbering', message: `Periods must be numbered 1 to ${content.periods.length} in order (found ${p.number} at position ${i + 1})`, period: i + 1 });
  });
  if (!content.differentiation.support.length || !content.differentiation.onLevel.length || !content.differentiation.challenge.length) {
    warnings.push({ code: 'differentiation_incomplete', message: 'Differentiation should give support, on-level and challenge ideas' });
  }
  if (!content.misconceptions.length) warnings.push({ code: 'no_misconceptions', message: 'No common misconceptions listed' });

  // Period level
  const taught = new Set<string>();
  content.periods.forEach((p) => {
    const at = { period: p.number };
    if (!p.topic) errors.push({ code: 'period_no_topic', message: `Period ${p.number} has no topic`, ...at });
    if (!p.sequence.length) {
      errors.push({ code: 'period_no_sequence', message: `Period ${p.number} has no teaching sequence`, ...at });
    } else {
      const last = p.sequence.length - 1;
      p.sequence.forEach((s, k) => {
        const where = `Period ${p.number}, step ${k + 1} (${PHASE_LABELS[s.phase]})`;
        if (s.marker) {
          // Messages here never suggest the marker as a way out: they feed the repair prompt.
          if (s.phase !== 'conclusion') errors.push({ code: 'step_marker', message: `${where}: only a conclusion can be an untimed closing marker`, ...at });
          else if (k !== last) errors.push({ code: 'step_marker', message: `${where}: an untimed closing marker must be the last step`, ...at });
          else if (s.minutes !== 0 && !Number.isNaN(s.minutes)) errors.push({ code: 'step_marker', message: `${where}: an untimed closing marker takes 0 minutes (found ${s.minutes})`, ...at });
        } else if (!Number.isInteger(s.minutes) || s.minutes < 1) {
          const found = Number.isNaN(s.minutes) ? 'missing' : String(s.minutes);
          errors.push({ code: 'step_minutes', message: `${where}: minutes must be a whole number of at least 1 (found ${found})`, ...at });
        }
        if (!s.teacher && !s.students) errors.push({ code: 'step_empty', message: `Period ${p.number}, step ${k + 1} says nothing for teacher or students`, ...at });
      });
      const total = periodMinutes(p);
      if (total !== ctx.minutesPerPeriod) {
        errors.push({ code: 'minutes_mismatch', message: `Period ${p.number} adds up to ${Number.isNaN(total) ? 'an unknown number of' : total} minutes, not ${ctx.minutesPerPeriod}`, ...at });
      }
      if (p.sequence[0].phase !== 'introduction') {
        warnings.push({ code: 'sequence_start', message: `Period ${p.number} does not start with an introduction`, ...at });
      }
      if (!['check', 'conclusion'].includes(p.sequence[p.sequence.length - 1].phase)) {
        warnings.push({ code: 'sequence_end', message: `Period ${p.number} does not end with a check or conclusion`, ...at });
      }
    }
    p.objectiveIds.forEach((id) => {
      if (!objIds.has(id)) errors.push({ code: 'unknown_objective', message: `Period ${p.number} refers to objective ${id}, which does not exist`, ...at });
      else taught.add(id);
    });
    if (!p.questions.length) errors.push({ code: 'period_no_questions', message: `Period ${p.number} has no assessment questions`, ...at });
    p.questions.forEach((q, k) => {
      if (!q.question) errors.push({ code: 'question_empty', message: `Period ${p.number}, question ${k + 1} is empty`, ...at });
      if (!q.answer) errors.push({ code: 'question_no_answer', message: `Period ${p.number}, question ${k + 1} has no expected answer`, ...at });
      if (!q.objectiveIds.length) errors.push({ code: 'question_unmapped', message: `Period ${p.number}, question ${k + 1} is not linked to an objective`, ...at });
      q.objectiveIds.forEach((id) => {
        if (!objIds.has(id)) errors.push({ code: 'question_unknown_objective', message: `Period ${p.number}, question ${k + 1} refers to objective ${id}, which does not exist`, ...at });
      });
    });
    if (!p.exitTicket && !p.sequence.some((s) => s.phase === 'conclusion' || s.phase === 'check')) {
      warnings.push({ code: 'no_closure', message: `Period ${p.number} has no exit ticket or closing check`, ...at });
    }
  });
  content.objectives.forEach((o) => {
    if (content.periods.length && !taught.has(o.id)) warnings.push({ code: 'objective_not_taught', message: `Objective ${o.id} is not taught in any period` });
  });

  // Sources: evidence only. A cited page must be one the model was given; a claim on
  // the textbook must cite such a page; the model's own groundingNotes never adds or
  // removes a warning (in the first pilot it said "the source covers all chapter
  // content" and the old check turned that sentence into a "did not cover" warning).
  const removed = new Set<number>();
  const keep = (pages: number[]) => pages.filter((n) => (ctx.allowedPages.has(n) ? true : (removed.add(n), false)));
  const unsupported: string[] = [];
  content.objectives.forEach((o) => {
    o.source.pages = keep(o.source.pages);
    if (o.source.type === 'textbook' && (!ctx.allowedPages.size || !o.source.pages.length)) {
      o.source.type = 'suggestion';
      unsupported.push(o.id);
    }
  });
  const conceptsBefore = content.keyConcepts.map((k) => k.pages.length);
  content.keyConcepts.forEach((k) => { k.pages = keep(k.pages); });
  content.periods.forEach((p) => { p.pages = keep(p.pages); });
  if (removed.size) {
    warnings.push({ code: 'pages_removed', message: `Removed page numbers not in the textbook extract: ${[...removed].sort((a, b) => a - b).join(', ')}` });
  }
  if (!ctx.allowedPages.size) {
    warnings.push({ code: 'ungrounded', message: 'No textbook extract was available for this chapter, so nothing in this plan is verified against the book' });
  } else {
    if (unsupported.length) {
      warnings.push({ code: 'unsupported_claims', message: `Objective ${unsupported.join(', ')} claimed the textbook but cites no page of the extract; marked as a teaching suggestion` });
    }
    const conceptsLost = content.keyConcepts.filter((k, i) => conceptsBefore[i] > 0 && !k.pages.length).map((k) => k.term);
    if (conceptsLost.length) {
      warnings.push({ code: 'unsupported_claims', message: `Key concept ${conceptsLost.join(', ')}: every cited page was outside the extract` });
    }
    const uncited = content.periods.filter((p) => !p.pages.length).map((p) => p.number);
    if (uncited.length) {
      warnings.push({ code: 'grounding_gaps', message: `Period ${uncited.join(', ')} cites no page of the textbook extract, so its content is not tied to the book; check it against the textbook`, ...(uncited.length === 1 ? { period: uncited[0] } : {}) });
    }
    if (ctx.sourceTruncated && ctx.sourceTruncated.used < ctx.sourceTruncated.available) {
      warnings.push({ code: 'source_truncated', message: `The textbook extract was too long: the AI saw ${ctx.sourceTruncated.used} of ${ctx.sourceTruncated.available} passages, so later parts of the chapter may be missing or unchecked` });
    }
  }

  return { content, errors, warnings };
}

// ── legacy text rendering (v1 columns and the period text columns) ───────────

const bullets = (items: string[]) => items.map((s) => `- ${s}`).join('\n');
const pagesNote = (pages: number[]) => (pages.length ? ` (p. ${pages.join(', ')})` : '');

export function renderLegacyFields(c: LessonPlanContent) {
  return {
    title: c.title,
    learningObjectives: c.objectives
      .map((o) => `- **${o.id}** (${o.bloom}) ${o.text} — *check:* ${o.assessment}${o.source.type === 'textbook' ? pagesNote(o.source.pages) : ' *(teaching suggestion)*'}`)
      .join('\n'),
    priorKnowledge: bullets(c.prerequisites),
    methodology: [
      c.keyConcepts.length ? `**Key concepts**\n${c.keyConcepts.map((k) => `- **${k.term}** — ${k.meaning}${pagesNote(k.pages)}`).join('\n')}` : '',
      c.misconceptions.length ? `**Common misconceptions**\n${c.misconceptions.map((m) => `- ${m.misconception} → ${m.correction}`).join('\n')}` : '',
      `**Differentiation**\n- *Support:* ${c.differentiation.support.join('; ') || '—'}\n- *On-level:* ${c.differentiation.onLevel.join('; ') || '—'}\n- *Challenge:* ${c.differentiation.challenge.join('; ') || '—'}${c.differentiation.accessibility.length ? `\n- *Accessibility:* ${c.differentiation.accessibility.join('; ')}` : ''}`,
    ].filter(Boolean).join('\n\n'),
    resources: bullets(c.resources),
    digitalResources: '',
    assessmentPlan: c.objectives.map((o) => `- ${o.id}: ${o.assessment}`).join('\n'),
    homeworkSummary: c.periods.filter((p) => p.homework).map((p) => `- Period ${p.number}: ${p.homework}`).join('\n'),
    expectedOutcomes: bullets(c.outcomes),
  };
}

/** A period's teaching minutes: the sum of its timed steps (an untimed closing marker adds nothing). NaN if a duration is missing. */
export function periodMinutes(p: Pick<Period, 'sequence'>): number {
  return p.sequence.reduce((a, s) => (s.marker ? a : a + s.minutes), 0);
}

/**
 * Which pages the model was given, from the AI service's reply. The reply's
 * `source` is authoritative when present: the service may leave passages out to
 * fit the prompt, and a page it left out must not be citable. Without a `source`
 * block (an older AI service) the passages sent are the best evidence.
 */
export function sourceContextFromReply(reply: any, suppliedPages: number[]): Pick<ValidationContext, 'allowedPages' | 'sourceTruncated'> {
  const src = reply?.source;
  if (src && typeof src === 'object' && typeof src.grounded === 'boolean') {
    const pages = src.grounded ? pageList(src.pages) : [];
    const used = Number(src.passagesUsed);
    const available = Number(src.passagesAvailable);
    return {
      allowedPages: new Set(pages),
      ...(src.truncated === true && Number.isFinite(used) && Number.isFinite(available) ? { sourceTruncated: { used, available } } : {}),
    };
  }
  return { allowedPages: new Set(suppliedPages.filter((n) => Number.isInteger(n) && n > 0)) };
}

export function renderLegacyPeriod(p: Period, c: LessonPlanContent) {
  const objText = p.objectiveIds.map((id) => c.objectives.find((o) => o.id === id)).filter(Boolean)
    .map((o) => `- **${o!.id}** ${o!.text}`).join('\n');
  return {
    periodNo: p.number,
    title: p.topic || `Period ${p.number}`,
    objectives: objText,
    activities: p.sequence.map((s, i) => `${i + 1}. **${PHASE_LABELS[s.phase]} (${s.marker ? 'closing note' : `${s.minutes} min`})** — *Teacher:* ${s.teacher}${s.students ? ` *Students:* ${s.students}` : ''}`).join('\n')
      + (p.examples.length ? `\n\n**Examples**\n${bullets(p.examples)}` : ''),
    resources: bullets(p.resources),
    assessment: [
      p.checks.length ? `**Checks for understanding**\n${bullets(p.checks)}` : '',
      p.questions.length ? `**Questions**\n${p.questions.map((q, i) => `${i + 1}. ${q.question} *(${q.objectiveIds.join(', ')})*\n    - *Answer:* ${q.answer}`).join('\n')}` : '',
      p.exitTicket ? `**Exit ticket:** ${p.exitTicket}` : '',
    ].filter(Boolean).join('\n\n'),
    homework: p.homework,
    durationMinutes: Math.max(0, periodMinutes(p) || 0),
  };
}

/** One-line summary of errors for the plan's `error` column and the repair prompt. */
export function describeIssues(issues: QualityIssue[], max = 12): string {
  const lines = issues.slice(0, max).map((i) => `- ${i.message}`);
  if (issues.length > max) lines.push(`- …and ${issues.length - max} more`);
  return lines.join('\n');
}
