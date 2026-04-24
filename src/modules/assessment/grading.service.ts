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

/** Tuned from batch / mock context so board vs entrance-style expectations differ. */
export type DescriptiveGradingContext = {
  examTarget?: string | null;
  classLabel?: string | null;
  /**
   * When true, keep the full CBSE-style step mark bands (2–5m structure below) and board
   * leniency, merged with `examTarget` / `classLabel` (cohort) — does not remove board marking
   * just because the batch also mentions a competitive exam.
   */
  preferBoardMarking?: boolean;
};

@Injectable()
export class GradingService {
  getDescriptiveRubricBreakdown(
    question: Question,
    attempt: QuestionAttempt,
    ctx?: DescriptiveGradingContext,
  ): Record<string, number> | null {
    if (question.type !== QuestionType.DESCRIPTIVE) return null;
    return this.computeDescriptiveRubric(question, attempt, ctx).breakdown;
  }

  gradeAttempt(
    question: Question,
    attempt: QuestionAttempt,
    ctx?: DescriptiveGradingContext,
  ): GradeAttemptResult {
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
      return this.gradeDescriptive(question, attempt, ctx);
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
      const hasImages =
        Array.isArray((attempt as any).answerImageUrls) && ((attempt as any).answerImageUrls as string[]).length > 0;
      return Boolean(attempt.integerAnswer?.trim() || (attempt.selectedOptionIds || []).length || hasImages);
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

  private gradeDescriptive(
    question: Question,
    attempt: QuestionAttempt,
    ctx?: DescriptiveGradingContext,
  ): GradeAttemptResult {
    const scored = this.computeDescriptiveRubric(question, attempt, ctx);
    return {
      isCorrect: scored.isCorrect,
      marksAwarded: scored.marksAwarded,
      errorType: scored.errorType,
      rubricBreakdown: scored.breakdown,
    };
  }

  /**
   * Board band → integer CBSE-style step marks + board overlap/leniency (`ov=0`, `passFactor=0.6`).
   * Competitive → stricter keyword alignment. Merged cohort: if `preferBoardMarking` is set from
   * mock title / batch, board (CBSE) marking wins; otherwise test board keywords before competitive
   * so "CBSE + class" is not lost to a single JEE token in the same string.
   */
  private inferGradingBand(ctx?: DescriptiveGradingContext): 'board' | 'competitive' | 'general' {
    if (ctx?.preferBoardMarking) {
      return 'board';
    }
    const t = `${ctx?.examTarget || ''} ${ctx?.classLabel || ''}`.toLowerCase();
    if (
      /\b(cbse|icse|hsc|ssc|ncert|matric|state board|board exam|10th|12th|class\s*10|class\s*12)\b/.test(
        t,
      ) ||
      /\b(board|school board)\b/.test(t)
    ) {
      return 'board';
    }
    if (/\b(jee|neet|iit|bits|kvpy|nda|mains|advanced|entrance|competitive|gate|cat|jee\s*main)\b/.test(t)) {
      return 'competitive';
    }
    if (/\b(class\s*9|class\s*11)\b/.test(t)) {
      return 'board';
    }
    return 'general';
  }

  private computeDescriptiveRubric(
    question: Question,
    attempt: QuestionAttempt,
    ctx?: DescriptiveGradingContext,
  ): { isCorrect: boolean; marksAwarded: number; errorType: ErrorType | null; breakdown: Record<string, number> } {
    const answer = String(attempt.integerAnswer ?? '').trim();
    const hasImage = Array.isArray((attempt as any).answerImageUrls) && ((attempt as any).answerImageUrls || []).length > 0;
    if (!answer && !hasImage) {
      return { isCorrect: false, marksAwarded: 0, errorType: ErrorType.SKIPPED, breakdown: {} };
    }

    // If only image is present, consider attempted but conservative until OCR (vision) runs (submitSession enriches first).
    if (!answer && hasImage) {
      return { isCorrect: false, marksAwarded: 0, errorType: ErrorType.CONCEPTUAL, breakdown: {} };
    }

    const band = this.inferGradingBand(ctx);
    /** Competitive papers expect closer alignment to the model’s key terms; board uses baseline gates. */
    const ov = band === 'competitive' ? 0.04 : band === 'general' ? 0.01 : 0;
    const passFactor = band === 'competitive' ? 0.65 : 0.6;

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
      if (hasDefinitionLead || overlap >= 0.22 + ov) { awarded += 1; breakdown.definition = 1; }
      if (pointsProvided >= 2 || hasExampleOrConclusion || overlap >= 0.35 + ov) { awarded += 1; breakdown.secondPoint = 1; }
      awarded = Math.min(2, awarded);
    } else if (maxMarks === 3) {
      if (hasDefinitionLead || overlap >= 0.2 + ov) { awarded += 1; breakdown.definition = 1; }
      if (pointsProvided >= 2) { awarded += 1; breakdown.explanationPoint1 = 1; }
      if (pointsProvided >= 3 || overlap >= 0.38 + ov) { awarded += 1; breakdown.explanationPoint2 = 1; }
      awarded = Math.min(3, awarded);
    } else if (maxMarks === 4) {
      if (hasDefinitionLead || overlap >= 0.2 + ov) { awarded += 1; breakdown.definitionOrFormula = 1; }
      if (pointsProvided >= 2) { awarded += 1; breakdown.explanationPoint1 = 1; }
      if (pointsProvided >= 3 || overlap >= 0.35 + ov) { awarded += 1; breakdown.explanationPoint2 = 1; }
      if (hasExampleOrConclusion || pointsProvided >= 4 || overlap >= 0.5 + ov) { awarded += 1; breakdown.supportingElement = 1; }
      awarded = Math.min(4, awarded);
    } else {
      // 5 or higher: primary band is board (CBSE-style) when batch is board-oriented; else same structure with stricter ov for competitive.
      if (hasDefinitionLead || overlap >= 0.2 + ov) { awarded += 1; breakdown.introduction = 1; }
      if (pointsProvided >= 2) { awarded += 1; breakdown.corePoint1 = 1; }
      if (pointsProvided >= 3) { awarded += 1; breakdown.corePoint2 = 1; }
      if (pointsProvided >= 4 || overlap >= 0.4 + ov) { awarded += 1; breakdown.corePoint3 = 1; }
      if (hasExampleOrConclusion || pointsProvided >= 5 || overlap >= 0.55 + ov) { awarded += 1; breakdown.supportingElement = 1; }
      awarded = Math.min(5, awarded);
      if (maxMarks > 5) awarded = Math.min(maxMarks, awarded);
    }

    // Never negative for descriptive; wrong => 0 (not negative marking).
    const isCorrect = awarded >= Math.ceil(Math.min(maxMarks, 5) * passFactor);

    return {
      isCorrect,
      marksAwarded: Math.max(0, awarded),
      errorType: isCorrect ? null : ErrorType.CONCEPTUAL,
      breakdown,
    };
  }
}
