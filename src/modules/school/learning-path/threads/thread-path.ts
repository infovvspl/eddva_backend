import { MasteryConfig } from '../engine/mastery-config';

/**
 * Rules of the curved path, as pure functions. Each round is
 *   videos -> notes -> quiz -> formal assessment
 * Videos and notes are open from the start (videos are optional); finishing
 * the notes unlocks the quiz. Weak concepts in a quiz or an assessment add a
 * new round below, focused on them, until MAX_ROUNDS; the last round always
 * ends with an assessment, so every path finishes with a measured score.
 */

export const STEP_KINDS = ['videos', 'notes', 'quiz', 'assessment'] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export type StepStatus = 'locked' | 'active' | 'done' | 'skipped';
export const MAX_ROUNDS = 3;
const MAX_FOCUS = 6;

export function initialStepStatus(kind: StepKind): StepStatus {
  return kind === 'videos' || kind === 'notes' ? 'active' : 'locked';
}

export interface WeakConcept {
  conceptTag: string;
  accuracy: number;
}

export type QuizDecision = { action: 'extend'; focus: string[] } | { action: 'unlock_assessment' };

/** After a quiz: weak concepts start a focused round below (not on the last round), otherwise the assessment opens. */
export function decideAfterQuiz(round: number, weakConcepts: WeakConcept[]): QuizDecision {
  if (weakConcepts.length && round < MAX_ROUNDS) {
    return { action: 'extend', focus: weakConcepts.slice(0, MAX_FOCUS).map((c) => c.conceptTag) };
  }
  return { action: 'unlock_assessment' };
}

export type AssessmentDecision =
  | { action: 'complete' }
  | { action: 'extend'; focus: string[] }
  | { action: 'needs_teacher'; focus: string[] };

/**
 * After the formal assessment: at or above the at-risk threshold with no weak
 * concept, the topic is done. Otherwise another focused round, or after the
 * last round, a flag for the teacher.
 */
export function decideAfterAssessment(
  round: number,
  accuracy: number,
  weakConcepts: WeakConcept[],
  cfg: MasteryConfig,
): AssessmentDecision {
  const focus = weakConcepts.slice(0, MAX_FOCUS).map((c) => c.conceptTag);
  if (accuracy >= cfg.thresholds.atRisk && !weakConcepts.length) return { action: 'complete' };
  if (round < MAX_ROUNDS) return { action: 'extend', focus };
  return { action: 'needs_teacher', focus };
}

/** A failing assessment hints at a gap in an earlier topic of the same chapter. */
export function shouldSuggestPrerequisite(accuracy: number, cfg: MasteryConfig): boolean {
  return accuracy < cfg.thresholds.weak;
}

export interface PrerequisiteCandidate {
  topicId: string;
  sortOrder: number;
  status: string | null;
  mastery: number | null;
}

/**
 * The earlier topic of the chapter most likely to be the gap: not yet shown
 * as ok or mastered, lowest mastery first (unknown counts as lowest), nearest
 * to the current topic on a tie.
 */
export function pickPrerequisite(currentSortOrder: number, candidates: PrerequisiteCandidate[]): string | null {
  const earlier = candidates.filter(
    (c) => c.sortOrder < currentSortOrder && c.status !== 'ok' && c.status !== 'mastered',
  );
  if (!earlier.length) return null;
  earlier.sort((a, b) => (a.mastery ?? -1) - (b.mastery ?? -1) || b.sortOrder - a.sortOrder);
  return earlier[0].topicId;
}

export interface ThreadContextInput {
  topicName: string | null;
  chapterName: string | null;
  subjectName: string | null;
  round: number;
  currentStep: StepKind | null;
  weakConcepts: string[];
  results: { kind: 'quiz' | 'assessment'; round: number; accuracy: number }[];
  baselineMastery: number | null;
}

/**
 * What the tutor needs to know about where the student is in this chat,
 * built from stored facts rather than an AI summary: free, exact, and it
 * cannot drift. Sent ahead of the student's message, never stored or shown.
 */
/**
 * How steps are named in the context sent to the AI tutor. It switches to
 * quiz mode whenever the message contains "quiz", "test me", "MCQ" or
 * "practice", so the context must not: otherwise, once a student had taken the
 * path's quiz, every question in the chat came back as a quiz.
 */
const STEP_NAME: Record<StepKind, string> = { videos: 'video', notes: 'AI notes', quiz: 'short check', assessment: 'formal assessment' };

/**
 * Added to the context of an ordinary chat message (not "Quiz me"): practice
 * questions come only when the student asks for them with the Quiz me button.
 * Worded without the words that switch the AI tutor into quiz mode.
 */
export const ANSWER_ONLY =
  '[How to reply] Answer the student\'s message directly. Do not set the student any questions to answer, ' +
  'with or without options, and do not end with a question for them to work on.';

/** A "Quiz me" turn (the request or the questions): left out of the history so later answers do not carry on with questions. */
export function isQuizTurn(m: { role: string; content_json?: any }): boolean {
  const c = m.content_json ?? {};
  if (m.role === 'student') return c.mode === 'quiz' || /^\s*quiz me\b/i.test(String(c.text ?? ''));
  return Array.isArray(c.quiz?.questions) && c.quiz.questions.length > 0;
}

export function buildThreadContext(input: ThreadContextInput): string {
  const parts: string[] = [];
  const where = [input.subjectName, input.chapterName, input.topicName].filter(Boolean).join(' > ');
  if (where) parts.push(`Topic: ${where}.`);
  parts.push(`Learning path round ${input.round}${input.currentStep ? `, currently on: ${STEP_NAME[input.currentStep]}` : ''}.`);
  if (input.baselineMastery !== null) parts.push(`Score on this topic before starting: ${Math.round(input.baselineMastery)}%.`);
  if (input.weakConcepts.length) parts.push(`Weak concepts to focus on: ${input.weakConcepts.slice(0, MAX_FOCUS).join('; ')}.`);
  const recent = input.results.slice(-3);
  if (recent.length) {
    parts.push(`Recent results: ${recent.map((r) => `${STEP_NAME[r.kind]} (round ${r.round}) ${Math.round(r.accuracy)}%`).join(', ')}.`);
  }
  return `[Learning-path context, for the tutor only] ${parts.join(' ')}`.slice(0, 900);
}
