import { BadRequestException } from '@nestjs/common';

export type QuestionSource = 'bank' | 'ai' | 'manual';

export interface QuestionOption {
  label: string;
  text: string;
}

/** A question as stored on an assignment (a snapshot, independent of where it came from). */
export interface AssignmentQuestion {
  type: string;
  text: string;
  options: QuestionOption[] | null;
  /** Option label(s) for objective questions (e.g. "B" or "A,C"), model answer for written ones. */
  correctAnswer: string | null;
  explanation: string | null;
  marks: number;
  topicName: string | null;
  source: QuestionSource;
  sourceRef: string | null;
}

export const OBJECTIVE_TYPES = new Set(['mcq_single', 'mcq_multiple', 'true_false']);
export const MAX_QUESTIONS_PER_ASSIGNMENT = 100;
const LABELS = 'ABCDEFGH';

const str = (v: unknown) => (v == null ? '' : String(v)).trim();

function normalizeOptions(raw: unknown): QuestionOption[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = raw
    .map((o: any, i: number) => {
      const text = str(o && typeof o === 'object' ? o.text ?? o.content ?? o.optionText : o);
      const label = str(o && typeof o === 'object' ? o.label ?? o.optionLabel : '') || LABELS[i] || String(i + 1);
      return { label: label.toUpperCase().slice(0, 2), text };
    })
    .filter((o) => o.text);
  return out.length ? out : null;
}

/** Labels of the correct options, from an explicit answer or per-option isCorrect flags. */
function correctLabels(rawOptions: unknown, answer: unknown, options: QuestionOption[] | null): string | null {
  if (!options) return null;
  const flagged: string[] = [];
  if (Array.isArray(rawOptions)) {
    rawOptions.forEach((o: any, i: number) => {
      if (o && typeof o === 'object' && o.isCorrect === true && options[i]) flagged.push(options[i].label);
    });
  }
  if (flagged.length) return flagged.join(',');

  const parts = (Array.isArray(answer) ? answer : str(answer).split(/[,;\s]+/)).map((x) => str(x).toUpperCase()).filter(Boolean);
  const labels = options.map((o) => o.label);
  const byLabel = parts.filter((p) => labels.includes(p));
  if (byLabel.length) return byLabel.join(',');

  // answer given as the option text
  const wanted = str(Array.isArray(answer) ? answer[0] : answer).toLowerCase();
  const match = options.find((o) => o.text.toLowerCase() === wanted);
  return match ? match.label : null;
}

/** A question stored inside an assessment (questions_json). */
export function fromBankQuestion(raw: any, ref: string): AssignmentQuestion | null {
  const text = str(raw?.text ?? raw?.question);
  if (!text) return null;
  const options = normalizeOptions(raw.options);
  const type = str(raw.type) || (options ? 'mcq_single' : 'short_answer');
  const answer = raw.correctAnswer ?? raw.correct_answer;
  return {
    type,
    text,
    options,
    correctAnswer: options ? correctLabels(raw.options, answer, options) : str(answer) || null,
    explanation: str(raw.explanation) || null,
    marks: Number(raw.marks) > 0 ? Number(raw.marks) : 1,
    topicName: str(raw.topicName ?? raw.topic) || null,
    source: 'bank',
    sourceRef: ref,
  };
}

/** A question returned by the Eddva AI generator. */
export function fromAiQuestion(raw: any, opts: { topicName?: string | null; type: string; marks?: number }): AssignmentQuestion | null {
  const text = str(raw?.content ?? raw?.questionText ?? raw?.question ?? raw?.text);
  if (!text) return null;
  const options = normalizeOptions(raw.options);
  const answer = raw.answer ?? raw.correctAnswer ?? raw.correctOptions;
  const objective = !!options;
  return {
    type: objective ? (raw.type === 'mcq_multiple' ? 'mcq_multiple' : 'mcq_single') : opts.type === 'mcq_single' ? 'short_answer' : opts.type,
    text,
    options,
    correctAnswer: objective
      ? correctLabels(raw.options, answer, options)
      : str(raw.modelAnswer ?? raw.answer ?? raw.solution) || null,
    explanation: str(raw.explanation ?? raw.solutionText ?? raw.solution) || null,
    marks: opts.marks && opts.marks > 0 ? opts.marks : 1,
    topicName: opts.topicName ?? null,
    source: 'ai',
    sourceRef: null,
  };
}

/** Validates what the teacher submits and returns clean questions (400 on anything unusable). */
export function sanitizeQuestions(input: unknown): AssignmentQuestion[] {
  let list = input;
  if (typeof input === 'string' && input.trim()) {
    try {
      list = JSON.parse(input);
    } catch {
      throw new BadRequestException('questions is not valid JSON');
    }
  }
  if (list == null || list === '') return [];
  if (!Array.isArray(list)) throw new BadRequestException('questions must be a list');
  if (list.length > MAX_QUESTIONS_PER_ASSIGNMENT) {
    throw new BadRequestException(`An assignment can have at most ${MAX_QUESTIONS_PER_ASSIGNMENT} questions`);
  }

  return list.map((raw: any, i: number) => {
    const n = i + 1;
    const text = str(raw?.text);
    if (!text) throw new BadRequestException(`Question ${n} has no text`);
    const marks = Number(raw.marks);
    if (!(marks > 0) || marks > 1000) throw new BadRequestException(`Question ${n} needs marks greater than 0`);

    const options = normalizeOptions(raw.options);
    const type = str(raw.type) || (options ? 'mcq_single' : 'short_answer');
    let correctAnswer: string | null = str(raw.correctAnswer) || null;
    if (OBJECTIVE_TYPES.has(type)) {
      if (!options || options.length < 2) throw new BadRequestException(`Question ${n} needs at least two options`);
      const valid = new Set(options.map((o) => o.label));
      const picked = (correctAnswer || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
      if (!picked.length || picked.some((p) => !valid.has(p))) {
        throw new BadRequestException(`Question ${n} needs a valid correct answer`);
      }
      if (type !== 'mcq_multiple' && picked.length > 1) {
        throw new BadRequestException(`Question ${n} allows only one correct answer`);
      }
      correctAnswer = picked.join(',');
    }
    const source: QuestionSource = ['bank', 'ai', 'manual'].includes(raw.source) ? raw.source : 'manual';
    return {
      type,
      text: text.slice(0, 4000),
      options,
      correctAnswer,
      explanation: str(raw.explanation).slice(0, 4000) || null,
      marks,
      topicName: str(raw.topicName).slice(0, 200) || null,
      source,
      sourceRef: str(raw.sourceRef).slice(0, 200) || null,
    };
  });
}

export const totalMarks = (questions: { marks: number }[]) =>
  Math.round(questions.reduce((sum, q) => sum + Number(q.marks), 0) * 100) / 100;

/** Student-facing view: no answers or explanations. */
export function stripAnswers<T extends { correctAnswer?: unknown; explanation?: unknown }>(q: T) {
  const { correctAnswer: _a, explanation: _e, ...rest } = q;
  return rest;
}
