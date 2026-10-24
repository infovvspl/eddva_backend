import { sanitizeChatQuiz, scoreChatQuiz } from './chat-quiz';

const good = { question: 'Which way does a compass needle point near a wire?', options: ['Along the field line', 'Towards the wire', 'Away from the wire', 'Upwards'], answerIndex: 0, explanation: 'It lines up with the field.' };

describe('sanitizeChatQuiz', () => {
  it('keeps well-formed questions', () => {
    expect(sanitizeChatQuiz({ questions: [good] })).toEqual({ questions: [good] });
  });

  it('drops questions without text, with too few, empty or repeated options, or an answer that is not an option', () => {
    const bad = [
      { ...good, question: '  ' },
      { ...good, options: ['Only one'] },
      { ...good, options: ['A', ''] },
      { ...good, options: ['Same', 'same'] },
      { ...good, answerIndex: 4 },
      { ...good, answerIndex: 1.5 },
      { ...good, options: Array.from({ length: 7 }, (_, i) => `o${i}`) },
    ];
    expect(sanitizeChatQuiz({ questions: bad })).toBeNull();
    expect(sanitizeChatQuiz({ questions: [...bad, good] })).toEqual({ questions: [good] });
  });

  it('copes with no quiz at all, and caps the number of questions', () => {
    expect(sanitizeChatQuiz(undefined)).toBeNull();
    expect(sanitizeChatQuiz({ questions: 'nope' })).toBeNull();
    expect(sanitizeChatQuiz({ questions: Array.from({ length: 15 }, () => good) })!.questions).toHaveLength(10);
  });
});

describe('scoreChatQuiz', () => {
  const qs = [good, { ...good, answerIndex: 2 }];
  const now = new Date('2026-10-23T10:00:00Z');

  it('counts the right answers', () => {
    expect(scoreChatQuiz(qs, [0, 1], now)).toEqual({ answers: [0, 1], score: 1, total: 2, completedAt: '2026-10-23T10:00:00.000Z' });
    expect(scoreChatQuiz(qs, [0, 2], now)!.score).toBe(2);
  });

  it('refuses answers that do not fit the questions', () => {
    expect(scoreChatQuiz(qs, [0], now)).toBeNull();
    expect(scoreChatQuiz(qs, [0, 9], now)).toBeNull();
    expect(scoreChatQuiz(qs, [0, -1], now)).toBeNull();
    expect(scoreChatQuiz([], [], now)).toBeNull();
  });
});
