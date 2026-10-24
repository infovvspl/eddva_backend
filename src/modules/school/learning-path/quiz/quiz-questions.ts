import { randomInt } from 'crypto';

/**
 * Pure quiz logic: turning AI output into gradeable questions, hiding the
 * answer key from the student, and grading on the server. Every question that
 * reaches a student has exactly one correct option the model actually gave
 * (never a guessed key), four distinct options, and a concept tag.
 */

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  text: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string;
  conceptTag: string | null;
  difficulty: string | null;
}

/** What the browser sees before submission. */
export interface StudentQuizQuestion {
  id: string;
  text: string;
  options: QuizOption[];
  conceptTag: string | null;
}

export interface GradedResponse {
  questionId: string;
  conceptTag: string | null;
  answer: string | null;
  isCorrect: boolean;
}

export interface QuizGrade {
  responses: GradedResponse[];
  correct: number;
  total: number;
  accuracy: number;
}

const OPTIONS_PER_QUESTION = 4;
const MAX_TEXT = 4000;

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (s: string) => new Set(norm(s).split(' ').filter((t) => t.length > 2));

/**
 * Map a model-supplied concept (or, failing that, its subtopic label) onto one
 * of the concepts we asked for: exact match, then containment, then the best
 * word overlap of at least half. With no requested concepts the model's own
 * label is kept; with requested concepts and no match, the tag is null rather
 * than an invented concept.
 */
export function matchConcept(label: string | null | undefined, concepts: string[]): string | null {
  const raw = String(label ?? '').trim();
  if (!concepts.length) return raw ? raw.slice(0, 200) : null;
  if (!raw) return null;
  const n = norm(raw);
  const exact = concepts.find((c) => norm(c) === n);
  if (exact) return exact;
  const contained = concepts.find((c) => {
    const nc = norm(c);
    return nc.length > 3 && (n.includes(nc) || nc.includes(n));
  });
  if (contained) return contained;
  const t = tokens(raw);
  let best: { concept: string; score: number } | null = null;
  for (const c of concepts) {
    const tc = tokens(c);
    if (!tc.size || !t.size) continue;
    const overlap = [...t].filter((w) => tc.has(w)).length;
    const score = overlap / Math.min(t.size, tc.size);
    if (score >= 0.5 && (!best || score > best.score)) best = { concept: c, score };
  }
  return best?.concept ?? null;
}

/** Fisher–Yates with a cryptographic RNG; `rand(n)` is injectable for tests. */
export function shuffle<T>(items: T[], rand: (n: number) => number = (n) => randomInt(n)): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Validate the bridge's normalised MCQs. Drops questions with a guessed key,
 * not exactly one correct option, fewer than four distinct options, or a stem
 * already seen. Option order is shuffled (models favour putting the answer
 * first) and ids are assigned here, so nothing the model wrote becomes an id.
 */
export function buildQuizQuestions(
  raw: any[],
  concepts: string[],
  opts: { idPrefix: string; rand?: (n: number) => number },
): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  const seenStems = new Set<string>();
  for (const q of Array.isArray(raw) ? raw : []) {
    if (!q || q.answerDefaulted) continue;
    const text = String(q.content ?? q.questionText ?? q.question ?? '').trim().slice(0, MAX_TEXT);
    const stemKey = norm(text);
    if (!stemKey || seenStems.has(stemKey)) continue;

    const options: { text: string; isCorrect: boolean }[] = [];
    const seenOptions = new Set<string>();
    for (const o of Array.isArray(q.options) ? q.options : []) {
      const optText = String(typeof o === 'string' ? o : o?.content ?? o?.text ?? '').trim().slice(0, MAX_TEXT);
      const key = norm(optText);
      if (!key || seenOptions.has(key)) continue;
      seenOptions.add(key);
      options.push({ text: optText, isCorrect: typeof o === 'object' && o?.isCorrect === true });
    }
    if (options.length !== OPTIONS_PER_QUESTION) continue;
    if (options.filter((o) => o.isCorrect).length !== 1) continue;

    seenStems.add(stemKey);
    const qid = `${opts.idPrefix}${out.length + 1}`;
    const shuffled = shuffle(options, opts.rand).map((o, i) => ({ ...o, id: `${qid}o${i + 1}` }));
    out.push({
      id: qid,
      text,
      options: shuffled.map(({ id, text: t }) => ({ id, text: t })),
      correctOptionId: shuffled.find((o) => o.isCorrect)!.id,
      explanation: String(q.explanation ?? q.solutionText ?? '').trim().slice(0, MAX_TEXT),
      conceptTag: matchConcept(q.concept || q.subtopic, concepts),
      difficulty: q.difficulty ? String(q.difficulty) : null,
    });
  }
  return out;
}

export function toStudentQuestions(questions: QuizQuestion[]): StudentQuizQuestion[] {
  return questions.map((q) => ({ id: q.id, text: q.text, options: q.options, conceptTag: q.conceptTag }));
}

/** Keep only answers to real questions with a real option id; anything else is dropped. */
export function sanitizeAnswers(questions: QuizQuestion[], answers: unknown): Record<string, string> {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {};
  const out: Record<string, string> = {};
  for (const q of questions) {
    const a = (answers as Record<string, unknown>)[q.id];
    if (typeof a === 'string' && q.options.some((o) => o.id === a)) out[q.id] = a;
  }
  return out;
}

/** Unanswered questions count as wrong. */
export function gradeQuiz(questions: QuizQuestion[], answers: Record<string, string>): QuizGrade {
  const responses = questions.map((q) => {
    const answer = answers[q.id] ?? null;
    return { questionId: q.id, conceptTag: q.conceptTag, answer, isCorrect: answer === q.correctOptionId };
  });
  const correct = responses.filter((r) => r.isCorrect).length;
  const total = questions.length;
  return { responses, correct, total, accuracy: total ? Math.round((correct / total) * 10000) / 100 : 0 };
}
