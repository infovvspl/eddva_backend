import { DEFAULT_MASTERY_CONFIG as cfg } from '../engine/mastery-config';
import {
  ANSWER_ONLY,
  buildThreadContext,
  isQuizTurn,
  decideAfterAssessment,
  decideAfterQuiz,
  initialStepStatus,
  MAX_ROUNDS,
  pickPrerequisite,
  shouldSuggestPrerequisite,
} from './thread-path';

const weak = (...tags: string[]) => tags.map((conceptTag) => ({ conceptTag, accuracy: 30 }));

describe('initialStepStatus', () => {
  it('opens videos and notes, locks quiz and assessment', () => {
    expect(['videos', 'notes', 'quiz', 'assessment'].map((k) => initialStepStatus(k as any))).toEqual([
      'active', 'active', 'locked', 'locked',
    ]);
  });
});

describe('decideAfterQuiz', () => {
  it('adds a focused round for weak concepts', () => {
    expect(decideAfterQuiz(1, weak('Discriminant'))).toEqual({ action: 'extend', focus: ['Discriminant'] });
  });

  it('opens the assessment when nothing is weak', () => {
    expect(decideAfterQuiz(1, [])).toEqual({ action: 'unlock_assessment' });
  });

  it('never extends from the last round, so the path ends with an assessment', () => {
    expect(decideAfterQuiz(MAX_ROUNDS, weak('Discriminant'))).toEqual({ action: 'unlock_assessment' });
  });

  it('caps the focus list', () => {
    const d = decideAfterQuiz(1, weak('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'));
    expect(d.action === 'extend' && d.focus).toHaveLength(6);
  });
});

describe('decideAfterAssessment', () => {
  it('completes at or above the at-risk threshold with nothing weak', () => {
    expect(decideAfterAssessment(1, 70, [], cfg)).toEqual({ action: 'complete' });
  });

  it('extends when the score is low even if no concept was tagged weak', () => {
    expect(decideAfterAssessment(1, 55, [], cfg)).toEqual({ action: 'extend', focus: [] });
  });

  it('extends on a weak concept even with a good overall score', () => {
    expect(decideAfterAssessment(2, 80, weak('Roots'), cfg)).toEqual({ action: 'extend', focus: ['Roots'] });
  });

  it('flags the teacher after the last round', () => {
    expect(decideAfterAssessment(MAX_ROUNDS, 40, weak('Roots'), cfg)).toEqual({ action: 'needs_teacher', focus: ['Roots'] });
  });
});

describe('prerequisites', () => {
  it('only suggests one after a failing assessment', () => {
    expect(shouldSuggestPrerequisite(49, cfg)).toBe(true);
    expect(shouldSuggestPrerequisite(50, cfg)).toBe(false);
  });

  it('picks the weakest earlier topic not already ok, nearest on a tie', () => {
    const pick = pickPrerequisite(5, [
      { topicId: 'later', sortOrder: 6, status: 'weak', mastery: 10 },
      { topicId: 'fine', sortOrder: 1, status: 'ok', mastery: 75 },
      { topicId: 'weakish', sortOrder: 2, status: 'at_risk', mastery: 60 },
      { topicId: 'unknown-far', sortOrder: 3, status: 'not_assessed', mastery: null },
      { topicId: 'unknown-near', sortOrder: 4, status: null, mastery: null },
    ]);
    expect(pick).toBe('unknown-near');
  });

  it('returns null for the first topic of a chapter', () => {
    expect(pickPrerequisite(1, [{ topicId: 'x', sortOrder: 2, status: 'weak', mastery: 1 }])).toBeNull();
  });
});

describe('quiz only on Quiz me', () => {
  it('tells the tutor to just answer, without the words that switch it into quiz mode', () => {
    expect(ANSWER_ONLY).toMatch(/answer the student's message directly/i);
    expect(ANSWER_ONLY).not.toMatch(/\b(quiz|test me|mcqs?|multiple choice|practice|worksheet|exercise)\b/i);
  });

  it('spots Quiz me turns so they are left out of the history', () => {
    expect(isQuizTurn({ role: 'student', content_json: { text: 'Quiz me on Bar magnet.', mode: 'quiz' } })).toBe(true);
    expect(isQuizTurn({ role: 'student', content_json: { text: 'quiz me on this' } })).toBe(true); // saved before the mode was kept
    expect(isQuizTurn({ role: 'ai', content_json: { text: 'Here is a quiz', quiz: { questions: [{ question: 'Q?' }] } } })).toBe(true);
    expect(isQuizTurn({ role: 'student', content_json: { text: 'bar magnet' } })).toBe(false);
    expect(isQuizTurn({ role: 'ai', content_json: { text: 'A bar magnet has two poles.' } })).toBe(false);
  });
});

describe('buildThreadContext', () => {
  it('never contains the words that would switch the AI tutor into quiz mode', () => {
    const text = buildThreadContext({
      topicName: 'Discriminant', chapterName: 'Quadratic Equations', subjectName: 'Maths', round: 1, currentStep: 'quiz',
      weakConcepts: [], results: [{ kind: 'quiz', round: 1, accuracy: 50 }], baselineMastery: null,
    });
    expect(text).not.toMatch(/\b(quiz|test me|mcqs?|multiple choice|practice|worksheet|exercise)\b/i);
  });

  it('summarises where the student is from stored facts', () => {
    const text = buildThreadContext({
      topicName: 'Discriminant',
      chapterName: 'Quadratic Equations',
      subjectName: 'Maths',
      round: 2,
      currentStep: 'notes',
      weakConcepts: ['Nature of roots'],
      results: [
        { kind: 'quiz', round: 1, accuracy: 37.5 },
        { kind: 'assessment', round: 1, accuracy: 44 },
      ],
      baselineMastery: 31.4,
    });
    expect(text).toBe(
      '[Learning-path context, for the tutor only] Topic: Maths > Quadratic Equations > Discriminant. ' +
        'Learning path round 2, currently on: AI notes. Score on this topic before starting: 31%. ' +
        'Weak concepts to focus on: Nature of roots. Recent results: short check (round 1) 38%, formal assessment (round 1) 44%.',
    );
  });

  it('stays short', () => {
    const text = buildThreadContext({
      topicName: 'x'.repeat(500), chapterName: null, subjectName: null, round: 1, currentStep: null,
      weakConcepts: [], results: [], baselineMastery: null,
    });
    expect(text.length).toBeLessThanOrEqual(900);
  });
});
