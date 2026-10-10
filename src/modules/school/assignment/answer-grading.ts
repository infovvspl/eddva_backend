import { BadRequestException } from '@nestjs/common';
import { OBJECTIVE_TYPES, QuestionOption } from './assignment-questions';

/** Canonical form of an answer: upper-case labels, sorted, comma separated ("c, a" -> "A,C"). */
export function normalizeChoice(value: unknown): string {
  const parts = (Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/))
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(parts)).sort().join(',');
}

export interface StoredQuestion {
  id: string;
  type: string;
  marks: number;
  options?: QuestionOption[] | null;
  correctAnswer?: string | null;
}

export interface GradedAnswer {
  questionId: string;
  answer: string | null;
  isCorrect: boolean | null;
  /** null = needs a teacher (written answer) */
  marksAwarded: number | null;
}

/**
 * Validates the student's answers against the assignment's questions and grades
 * the objective ones. Every question gets a row (blank answers score 0 when
 * objective) so analytics denominators include students who skipped it.
 */
export function gradeAnswers(
  questions: StoredQuestion[],
  rawAnswers: unknown,
): { rows: GradedAnswer[]; fullyGraded: boolean; total: number; answered: number } {
  let map: any = {};
  if (typeof rawAnswers === 'string' && rawAnswers.trim()) {
    try {
      map = JSON.parse(rawAnswers);
    } catch {
      throw new BadRequestException('answers is not valid JSON');
    }
  } else if (rawAnswers && typeof rawAnswers === 'object') {
    map = rawAnswers;
  }
  if (map === null || Array.isArray(map) || typeof map !== 'object') {
    throw new BadRequestException('answers must be an object of questionId -> answer');
  }
  const known = new Set(questions.map((q) => q.id));
  for (const id of Object.keys(map)) {
    if (!known.has(id)) throw new BadRequestException('An answer refers to a question that is not in this assignment');
  }

  let total = 0;
  let answered = 0;
  let fullyGraded = true;
  const rows = questions.map((q): GradedAnswer => {
    const raw = map[q.id];
    if (OBJECTIVE_TYPES.has(q.type)) {
      const picked = normalizeChoice(raw);
      if (picked) {
        const valid = new Set((q.options || []).map((o) => o.label));
        if (picked.split(',').some((p) => !valid.has(p))) {
          throw new BadRequestException('An answer uses an option that does not exist');
        }
        if (q.type !== 'mcq_multiple' && picked.includes(',')) {
          throw new BadRequestException('Only one option can be chosen for this question');
        }
        answered++;
      }
      const correct = !!picked && picked === normalizeChoice(q.correctAnswer);
      const marksAwarded = correct ? Number(q.marks) : 0;
      total += marksAwarded;
      return { questionId: q.id, answer: picked || null, isCorrect: picked ? correct : false, marksAwarded };
    }
    const text = String(raw ?? '').trim().slice(0, 5000);
    if (text) answered++;
    fullyGraded = false;
    return { questionId: q.id, answer: text || null, isCorrect: null, marksAwarded: null };
  });
  return { rows, fullyGraded: fullyGraded && questions.length > 0, total: Math.round(total * 100) / 100, answered };
}
