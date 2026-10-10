import { BadRequestException } from '@nestjs/common';
import { gradeAnswers, normalizeChoice } from './answer-grading';
import { buildQuestionAnalytics } from './question-analytics';

describe('gradeAnswers', () => {
  const qs = [
    { id: 'q1', type: 'mcq_single', marks: 2, correctAnswer: 'B', options: [{ label: 'A', text: 'x' }, { label: 'B', text: 'y' }] },
    { id: 'q2', type: 'mcq_multiple', marks: 3, correctAnswer: 'A,C', options: [{ label: 'A', text: '' }, { label: 'B', text: '' }, { label: 'C', text: '' }] },
    { id: 'q3', type: 'short_answer', marks: 5 },
  ];

  it('normalises choices regardless of case, order and spacing', () => {
    expect(normalizeChoice(' c, a ')).toBe('A,C');
    expect(normalizeChoice(['b', 'B'])).toBe('B');
    expect(normalizeChoice(null)).toBe('');
  });

  it('grades objective answers and leaves written ones for the teacher', () => {
    const r = gradeAnswers(qs, { q1: 'B', q2: 'c,a', q3: 'Inertia is...' });
    expect(r.total).toBe(5);
    expect(r.fullyGraded).toBe(false);
    expect(r.rows.map((x) => x.marksAwarded)).toEqual([2, 3, null]);
    expect(r.answered).toBe(3);
  });

  it('scores a partial multi-select as zero and a blank as incorrect', () => {
    const r = gradeAnswers(qs.slice(0, 2), JSON.stringify({ q2: 'A' }));
    expect(r.rows[0]).toMatchObject({ answer: null, isCorrect: false, marksAwarded: 0 });
    expect(r.rows[1]).toMatchObject({ isCorrect: false, marksAwarded: 0 });
    expect(r.fullyGraded).toBe(true);
    expect(r.answered).toBe(1);
  });

  it('rejects unknown questions, unknown options and multiple picks on single-choice', () => {
    expect(() => gradeAnswers(qs, { nope: 'A' })).toThrow(BadRequestException);
    expect(() => gradeAnswers(qs, { q1: 'Z' })).toThrow(BadRequestException);
    expect(() => gradeAnswers(qs, { q1: 'A,B' })).toThrow(BadRequestException);
    expect(() => gradeAnswers(qs, '{oops')).toThrow(BadRequestException);
  });
});

describe('buildQuestionAnalytics', () => {
  const questions = [
    { id: 'q1', position: 1, text: 'Force unit', type: 'mcq_single', marks: 2, topicName: 'Motion',
      options: [{ label: 'A', text: 'J' }, { label: 'B', text: 'N' }, { label: 'C', text: 'W' }], correctAnswer: 'B' },
    { id: 'q2', position: 2, text: 'Define inertia', type: 'short_answer', marks: 4, topicName: 'Laws' },
  ];
  const answers = [
    { questionId: 'q1', answer: 'B', isCorrect: true, marksAwarded: 2 },
    { questionId: 'q1', answer: 'A', isCorrect: false, marksAwarded: 0 },
    { questionId: 'q1', answer: 'A', isCorrect: false, marksAwarded: 0 },
    { questionId: 'q1', answer: null, isCorrect: false, marksAwarded: 0 },
    { questionId: 'q2', answer: 'text', isCorrect: null, marksAwarded: 3 },
    { questionId: 'q2', answer: 'text', isCorrect: null, marksAwarded: null },
  ];

  it('reports per-question correctness, skips and the most chosen wrong option', () => {
    const { questions: qa } = buildQuestionAnalytics(questions, answers);
    expect(qa[0]).toMatchObject({ attempts: 4, skipped: 1, correctCount: 1, correctPercent: 25, mostChosenWrong: 'A' });
    expect(qa[0].optionCounts).toEqual({ A: 2, B: 1, C: 0 });
  });

  it('averages only graded written answers', () => {
    const { questions: qa } = buildQuestionAnalytics(questions, answers);
    expect(qa[1]).toMatchObject({ attempts: 2, correctPercent: null, avgPercent: 75 });
  });

  it('ranks topics weakest first and flags those under 60%', () => {
    const { topics } = buildQuestionAnalytics(questions, answers);
    expect(topics.map((t) => t.topic)).toEqual(['Motion', 'Laws']);
    expect(topics[0]).toMatchObject({ avgPercent: 25, weak: true });
    expect(topics[1]).toMatchObject({ avgPercent: 75, weak: false });
  });
});
