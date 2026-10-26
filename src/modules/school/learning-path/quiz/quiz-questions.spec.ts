import {
  buildQuizQuestions,
  gradeQuiz,
  matchConcept,
  sanitizeAnswers,
  shuffle,
  toStudentQuestions,
} from './quiz-questions';

const identity = (n: number) => n - 1; // keeps order under Fisher–Yates
const opts = (correct: number, texts = ['Alpha', 'Beta', 'Gamma', 'Delta']) =>
  texts.map((t, i) => ({ label: 'ABCD'[i], content: t, isCorrect: i === correct }));
const mcq = (over: Record<string, unknown> = {}) => ({
  content: 'What is the discriminant of x² + 2x + 1?',
  options: opts(1),
  explanation: 'b² − 4ac = 0.',
  concept: 'Discriminant',
  ...over,
});

describe('matchConcept', () => {
  const concepts = ['Discriminant', 'Nature of roots', 'Quadratic formula'];

  it('matches exactly, ignoring case and punctuation', () => {
    expect(matchConcept('discriminant!', concepts)).toBe('Discriminant');
  });

  it('matches by containment and by word overlap', () => {
    expect(matchConcept('Finding the discriminant value', concepts)).toBe('Discriminant');
    expect(matchConcept('roots nature', concepts)).toBe('Nature of roots');
  });

  it('returns null instead of inventing a concept', () => {
    expect(matchConcept('Graph plotting', concepts)).toBeNull();
    expect(matchConcept('', concepts)).toBeNull();
  });

  it('keeps the model label when no concepts were requested', () => {
    expect(matchConcept('Vertex form', [])).toBe('Vertex form');
  });
});

describe('shuffle', () => {
  it('is a permutation and does not mutate its input', () => {
    const input = [1, 2, 3, 4];
    const out = shuffle(input);
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4]);
  });
});

describe('buildQuizQuestions', () => {
  it('assigns its own ids and keeps the single correct option', () => {
    const [q] = buildQuizQuestions([mcq()], ['Discriminant'], { idPrefix: 'q', rand: identity });
    expect(q.id).toBe('q1');
    expect(q.options.map((o) => o.id)).toEqual(['q1o1', 'q1o2', 'q1o3', 'q1o4']);
    expect(q.options.find((o) => o.id === q.correctOptionId)!.text).toBe('Beta');
    expect(q.conceptTag).toBe('Discriminant');
  });

  it('falls back to the subtopic for the concept tag', () => {
    const [q] = buildQuizQuestions([mcq({ concept: undefined, subtopic: 'nature of the roots' })], ['Nature of roots'], {
      idPrefix: 'q',
    });
    expect(q.conceptTag).toBe('Nature of roots');
  });

  it('drops questions with a guessed key, no or several correct options, or too few options', () => {
    const built = buildQuizQuestions(
      [
        mcq({ answerDefaulted: true }),
        mcq({ content: 'No answer', options: opts(-1) }),
        mcq({ content: 'Two answers', options: opts(0).map((o, i) => ({ ...o, isCorrect: i < 2 })) }),
        mcq({ content: 'Duplicate options', options: opts(0, ['A', 'A', 'B', 'C']) }),
        mcq({ content: 'Three options', options: opts(0, ['A', 'B', 'C']) }),
      ],
      [],
      { idPrefix: 'q' },
    );
    expect(built).toEqual([]);
  });

  it('drops a repeated stem', () => {
    const built = buildQuizQuestions([mcq(), mcq({ content: 'what is the discriminant of x² + 2x + 1' })], [], { idPrefix: 'q' });
    expect(built).toHaveLength(1);
  });

  it('copes with junk input', () => {
    expect(buildQuizQuestions(null as any, [], { idPrefix: 'q' })).toEqual([]);
    expect(buildQuizQuestions([null, {}, 'x'], [], { idPrefix: 'q' })).toEqual([]);
  });
});

describe('student view, sanitising and grading', () => {
  const questions = buildQuizQuestions(
    [mcq(), mcq({ content: 'Roots of x² − 1?', options: opts(2), concept: 'Nature of roots' })],
    ['Discriminant', 'Nature of roots'],
    { idPrefix: 'q', rand: identity },
  );

  it('never sends the answer key or explanation to the student', () => {
    const view = toStudentQuestions(questions);
    expect(JSON.stringify(view)).not.toMatch(/correctOptionId|explanation|isCorrect/);
    expect(view[0].options).toHaveLength(4);
  });

  it('keeps only answers to real questions with real option ids', () => {
    expect(sanitizeAnswers(questions, { q1: 'q1o2', q2: 'q1o1', q9: 'q9o1', __proto__: 'x' })).toEqual({ q1: 'q1o2' });
    expect(sanitizeAnswers(questions, 'nonsense')).toEqual({});
    expect(sanitizeAnswers(questions, ['q1o1'])).toEqual({});
  });

  it('grades on the server and counts unanswered questions as wrong', () => {
    const grade = gradeQuiz(questions, { q1: questions[0].correctOptionId });
    expect(grade).toMatchObject({ correct: 1, total: 2, accuracy: 50 });
    expect(grade.responses).toEqual([
      { questionId: 'q1', conceptTag: 'Discriminant', answer: questions[0].correctOptionId, isCorrect: true },
      { questionId: 'q2', conceptTag: 'Nature of roots', answer: null, isCorrect: false },
    ]);
  });

  it('handles an empty quiz', () => {
    expect(gradeQuiz([], {})).toEqual({ responses: [], correct: 0, total: 0, accuracy: 0 });
  });
});
