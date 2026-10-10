import { BadRequestException } from '@nestjs/common';
import {
  fromAiQuestion,
  fromBankQuestion,
  sanitizeQuestions,
  stripAnswers,
  totalMarks,
} from './assignment-questions';

describe('assignment questions', () => {
  describe('fromBankQuestion', () => {
    it('keeps an assessment MCQ with its labelled options and answer', () => {
      const q = fromBankQuestion(
        { text: 'Unit of force?', type: 'mcq_single', marks: 2,
          options: [{ label: 'A', text: 'Joule' }, { label: 'B', text: 'Newton' }], correctAnswer: 'B' },
        'asm1:0',
      );
      expect(q).toMatchObject({ type: 'mcq_single', marks: 2, correctAnswer: 'B', source: 'bank', sourceRef: 'asm1:0' });
      expect(q!.options).toHaveLength(2);
    });

    it('treats a written question as short answer and skips empty text', () => {
      expect(fromBankQuestion({ text: 'Define inertia.', correctAnswer: 'Resistance to change' }, 'x')).toMatchObject({
        type: 'short_answer', options: null, marks: 1, correctAnswer: 'Resistance to change',
      });
      expect(fromBankQuestion({ text: '  ' }, 'x')).toBeNull();
    });
  });

  describe('fromAiQuestion', () => {
    it('reads isCorrect flags on options', () => {
      const q = fromAiQuestion(
        { content: 'Capital of India?', options: [{ content: 'Mumbai' }, { content: 'Delhi', isCorrect: true }] },
        { type: 'mcq_single', topicName: 'Capitals' },
      );
      expect(q).toMatchObject({ correctAnswer: 'B', topicName: 'Capitals', source: 'ai' });
      expect(q!.options![1]).toEqual({ label: 'B', text: 'Delhi' });
    });

    it('maps a plain-string answer to a label, by letter or by option text', () => {
      const opts = ['3', '4', '5'];
      expect(fromAiQuestion({ question: '2+2?', options: opts, answer: 'B' }, { type: 'mcq_single' })!.correctAnswer).toBe('B');
      expect(fromAiQuestion({ question: '2+2?', options: opts, answer: '4' }, { type: 'mcq_single' })!.correctAnswer).toBe('B');
    });

    it('keeps a model answer for written questions', () => {
      const q = fromAiQuestion({ content: 'Explain gravity.', answer: 'Attraction between masses' }, { type: 'short_answer' });
      expect(q).toMatchObject({ type: 'short_answer', options: null, correctAnswer: 'Attraction between masses' });
    });
  });

  describe('sanitizeQuestions', () => {
    const mcq = { type: 'mcq_single', text: 'Q', marks: 1, correctAnswer: 'A',
      options: [{ label: 'A', text: 'x' }, { label: 'B', text: 'y' }] };

    it('accepts valid questions, including a JSON string from a form field', () => {
      expect(sanitizeQuestions([mcq])).toHaveLength(1);
      expect(sanitizeQuestions(JSON.stringify([mcq]))[0].correctAnswer).toBe('A');
      expect(sanitizeQuestions(undefined)).toEqual([]);
    });

    it('rejects missing text, bad marks, and unusable objective questions', () => {
      expect(() => sanitizeQuestions([{ ...mcq, text: '' }])).toThrow(BadRequestException);
      expect(() => sanitizeQuestions([{ ...mcq, marks: 0 }])).toThrow(BadRequestException);
      expect(() => sanitizeQuestions([{ ...mcq, options: [{ label: 'A', text: 'x' }] }])).toThrow(BadRequestException);
      expect(() => sanitizeQuestions([{ ...mcq, correctAnswer: 'Z' }])).toThrow(BadRequestException);
      expect(() => sanitizeQuestions([{ ...mcq, correctAnswer: 'A,B' }])).toThrow(BadRequestException);
      expect(() => sanitizeQuestions('{oops')).toThrow(BadRequestException);
    });

    it('allows several answers only for mcq_multiple, and written questions need no key', () => {
      expect(sanitizeQuestions([{ ...mcq, type: 'mcq_multiple', correctAnswer: 'A,B' }])[0].correctAnswer).toBe('A,B');
      expect(sanitizeQuestions([{ type: 'long_answer', text: 'Discuss', marks: 5 }])[0].correctAnswer).toBeNull();
    });
  });

  it('totals marks and strips answers for students', () => {
    expect(totalMarks([{ marks: 1.5 }, { marks: 2 }])).toBe(3.5);
    expect(stripAnswers({ text: 'Q', correctAnswer: 'A', explanation: 'because' })).toEqual({ text: 'Q' });
  });
});
