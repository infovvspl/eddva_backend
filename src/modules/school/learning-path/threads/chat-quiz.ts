/**
 * Practice questions the AI tutor asks inside a topic's chat ("Quiz me").
 * The student answers by tapping an option and sees at once whether it was
 * right, with the explanation. Practice only: unlike the path's quiz and
 * formal assessment it does not count towards mastery, so the answer key is
 * sent with the questions. Pure, so it is unit-tested.
 */

export interface ChatQuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface ChatQuizResult {
  answers: number[];
  score: number;
  total: number;
  completedAt: string;
}

const MAX_QUESTIONS = 10;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

/** Keep only well-formed questions: text, 2–6 distinct options, an answer that is one of them. */
export function sanitizeChatQuiz(raw: unknown): { questions: ChatQuizQuestion[] } | null {
  const list = Array.isArray((raw as any)?.questions) ? (raw as any).questions : [];
  const questions: ChatQuizQuestion[] = [];
  for (const q of list) {
    const question = String(q?.question ?? '').trim().slice(0, 1000);
    const options = (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => String(o ?? '').trim().slice(0, 300));
    const answerIndex = Number(q?.answerIndex);
    if (!question || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS || options.some((o: string) => !o)) continue;
    if (new Set(options.map((o: string) => o.toLowerCase())).size !== options.length) continue;
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) continue;
    questions.push({ question, options, answerIndex, explanation: String(q?.explanation ?? '').trim().slice(0, 1000) });
    if (questions.length >= MAX_QUESTIONS) break;
  }
  return questions.length ? { questions } : null;
}

/** Score the student's answers; null when they do not fit the questions (wrong count or an option that does not exist). */
export function scoreChatQuiz(questions: ChatQuizQuestion[], answers: number[], now = new Date()): ChatQuizResult | null {
  if (!questions.length || answers.length !== questions.length) return null;
  if (answers.some((a, i) => !Number.isInteger(a) || a < 0 || a >= questions[i].options.length)) return null;
  return {
    answers,
    score: answers.filter((a, i) => a === questions[i].answerIndex).length,
    total: questions.length,
    completedAt: now.toISOString(),
  };
}
