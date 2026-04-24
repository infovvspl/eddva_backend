import { Injectable } from '@nestjs/common';

import {
  ErrorType,
  QuestionAttempt,
  TopicProgress,
  TopicStatus,
} from '../../database/entities/assessment.entity';
import { Question, QuestionType } from '../../database/entities/question.entity';
import { Topic } from '../../database/entities/subject.entity';

type GradeAttemptResult = {
  isCorrect: boolean;
  marksAwarded: number;
  errorType: ErrorType | null;
  rubricBreakdown?: Record<string, number>;
};

@Injectable()
export class GradingService {
  getDescriptiveRubricBreakdown(question: Question, attempt: QuestionAttempt): Record<string, number> | null {
    if (question.type !== QuestionType.DESCRIPTIVE) return null;
    return this.computeDescriptiveRubric(question, attempt).breakdown;
  }

  gradeAttempt(question: Question, attempt: QuestionAttempt): GradeAttemptResult {
    const answered = this.isAnswered(question, attempt);
    if (!answered) {
      return { isCorrect: false, marksAwarded: 0, errorType: ErrorType.SKIPPED };
    }

    let isCorrect = false;
    switch (question.type) {
      case QuestionType.MCQ_SINGLE:
      case QuestionType.MCQ_MULTI:
        isCorrect = this.hasExactOptionMatch(question, attempt.selectedOptionIds || []);
        break;
      case QuestionType.INTEGER:
        isCorrect = String(attempt.integerAnswer ?? '') === String(question.integerAnswer ?? '');
        break;
      case QuestionType.DESCRIPTIVE:
        break;
      default:
        isCorrect = false;
        break;
    }

    if (question.type === QuestionType.DESCRIPTIVE) {
      return this.gradeDescriptive(question, attempt);
    }

    if (isCorrect) {
      return { isCorrect: true, marksAwarded: question.marksCorrect || 0, errorType: null };
    }

    return {
      isCorrect: false,
      marksAwarded: question.marksWrong || 0,
      errorType: this.classifyWrongAnswer(question, attempt),
    };
  }

  computeAccuracy(correct: number, totalEvaluated: number) {
    if (!totalEvaluated) return 0;
    return Number(((correct / totalEvaluated) * 100).toFixed(2));
  }

  computeTopicProgressUpdate(
    current: TopicProgress | null,
    topic: Topic,
    scorePercentage: number,
    now: Date,
  ) {
    const progress = current ?? new TopicProgress();
    progress.topicId = topic.id;
    progress.tenantId = topic.tenantId;
    progress.attemptCount = (progress.attemptCount || 0) + 1;
    progress.bestAccuracy = Math.max(progress.bestAccuracy || 0, scorePercentage);

    const passed = scorePercentage >= (topic.gatePassPercentage ?? 70);
    const alreadyCompleted = current?.status === TopicStatus.COMPLETED;
    if (passed || alreadyCompleted) {
      progress.status = TopicStatus.COMPLETED;
      if (!progress.completedAt) progress.completedAt = now;
    } else {
      // Not passed → keep as IN_PROGRESS so student can retry; never lock them out
      progress.status = TopicStatus.IN_PROGRESS;
    }

    return progress;
  }

  private hasExactOptionMatch(question: Question, selectedOptionIds: string[]) {
    const expected = (question.options || [])
      .filter((option) => option.isCorrect)
      .map((option) => option.id)
      .sort();
    const actual = [...selectedOptionIds].sort();
    return expected.length === actual.length && expected.every((id, index) => id === actual[index]);
  }

  private isAnswered(question: Question, attempt: QuestionAttempt) {
    if (question.type === QuestionType.INTEGER) {
      return Boolean(attempt.integerAnswer?.trim());
    }

    if (question.type === QuestionType.DESCRIPTIVE) {
      return Boolean(attempt.integerAnswer?.trim() || (attempt.selectedOptionIds || []).length);
    }

    return (attempt.selectedOptionIds || []).length > 0;
  }

  private classifyWrongAnswer(question: Question, attempt: QuestionAttempt) {
    if (!this.isAnswered(question, attempt)) {
      return ErrorType.SKIPPED;
    }

    if ((attempt.timeSpentSeconds || 0) < 10) {
      return ErrorType.GUESSED_WRONG;
    }

    const avgTime = question.avgTimeSeconds || 0;
    if (avgTime > 0 && (attempt.timeSpentSeconds || 0) > avgTime * 1.5) {
      return ErrorType.TIME_PRESSURE;
    }

    return ErrorType.CONCEPTUAL;
  }

  private gradeDescriptive(question: Question, attempt: QuestionAttempt): GradeAttemptResult {
    const scored = this.computeDescriptiveRubric(question, attempt);
    return {
      isCorrect: scored.isCorrect,
      marksAwarded: scored.marksAwarded,
      errorType: scored.errorType,
      rubricBreakdown: scored.breakdown,
    };
  }

  private computeDescriptiveRubric(
    question: Question,
    attempt: QuestionAttempt,
  ): { isCorrect: boolean; marksAwarded: number; errorType: ErrorType | null; breakdown: Record<string, number> } {
    const answer = String(attempt.integerAnswer ?? '').trim();
    const hasImage = Array.isArray((attempt as any).answerImageUrls) && ((attempt as any).answerImageUrls || []).length > 0;
    if (!answer && !hasImage) {
      return { isCorrect: false, marksAwarded: 0, errorType: ErrorType.SKIPPED, breakdown: {} };
    }

    // If only image is present, consider attempted but conservative until OCR/manual review exists.
    if (!answer && hasImage) {
      return { isCorrect: false, marksAwarded: 0, errorType: ErrorType.CONCEPTUAL, breakdown: {} };
    }

    const maxMarks = Math.max(1, Number(question.marksCorrect || 1));
    const model = String((question as any).solutionText || '').trim();
    const answerLc = answer.toLowerCase();
    const modelLc = model.toLowerCase();

    const tokens = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2);

    const answerWords = new Set(tokens(answerLc));
    const modelWords = Array.from(new Set(tokens(modelLc)));
    const overlap = modelWords.length
      ? modelWords.filter((w) => answerWords.has(w)).length / modelWords.length
      : 0;

    const bulletCount = (answer.match(/(^|\n)\s*([-*]|\d+[\).])/g) || []).length;
    const sentenceCount = Math.max(
      1,
      answer
        .split(/[.!?]\s+/)
        .map((x) => x.trim())
        .filter(Boolean).length,
    );

    const pointsProvided = Math.max(bulletCount, sentenceCount);
    const hasExampleOrConclusion = /\b(example|for example|thus|therefore|hence|conclusion|in conclusion|diagram|fig\.?)\b/i.test(answer);
    const hasDefinitionLead = /\b(is|means|defined as|refers to|can be defined)\b/i.test(answer.split(/[.!?\n]/)[0] || answer);

    // CBSE rubric-based integer marking (no decimals):
    // 2m: 1(definition/statement) + 1(second point/example)
    // 3m: 1(definition/principle) + 2(explanation with 2 points)
    // 4m: 1(definition/formula/statement) + 2-3(explanation points) + 0-1(example/diagram/conclusion)
    // 5m: 1(intro/definition) + 3(core explanation points) + 1(supporting element)
    let awarded = 0;
    const breakdown: Record<string, number> = {};
    if (maxMarks <= 2) {
      if (hasDefinitionLead || overlap >= 0.22) { awarded += 1; breakdown.definition = 1; }
      if (pointsProvided >= 2 || hasExampleOrConclusion || overlap >= 0.35) { awarded += 1; breakdown.secondPoint = 1; }
      awarded = Math.min(2, awarded);
    } else if (maxMarks === 3) {
      if (hasDefinitionLead || overlap >= 0.2) { awarded += 1; breakdown.definition = 1; }
      if (pointsProvided >= 2) { awarded += 1; breakdown.explanationPoint1 = 1; }
      if (pointsProvided >= 3 || overlap >= 0.38) { awarded += 1; breakdown.explanationPoint2 = 1; }
      awarded = Math.min(3, awarded);
    } else if (maxMarks === 4) {
      if (hasDefinitionLead || overlap >= 0.2) { awarded += 1; breakdown.definitionOrFormula = 1; }
      if (pointsProvided >= 2) { awarded += 1; breakdown.explanationPoint1 = 1; }
      if (pointsProvided >= 3 || overlap >= 0.35) { awarded += 1; breakdown.explanationPoint2 = 1; }
      if (hasExampleOrConclusion || pointsProvided >= 4 || overlap >= 0.5) { awarded += 1; breakdown.supportingElement = 1; }
      awarded = Math.min(4, awarded);
    } else {
      // 5 or higher treated as 5-mark CBSE descriptive band
      if (hasDefinitionLead || overlap >= 0.2) { awarded += 1; breakdown.introduction = 1; }
      if (pointsProvided >= 2) { awarded += 1; breakdown.corePoint1 = 1; }
      if (pointsProvided >= 3) { awarded += 1; breakdown.corePoint2 = 1; }
      if (pointsProvided >= 4 || overlap >= 0.4) { awarded += 1; breakdown.corePoint3 = 1; }
      if (hasExampleOrConclusion || pointsProvided >= 5 || overlap >= 0.55) { awarded += 1; breakdown.supportingElement = 1; }
      awarded = Math.min(5, awarded);
      if (maxMarks > 5) awarded = Math.min(maxMarks, awarded);
    }

    // Never negative for descriptive; wrong => 0 (not negative marking).
    const isCorrect = awarded >= Math.ceil(Math.min(maxMarks, 5) * 0.6);

    return {
      isCorrect,
      marksAwarded: Math.max(0, awarded),
      errorType: isCorrect ? null : ErrorType.CONCEPTUAL,
      breakdown,
    };
  }
}
