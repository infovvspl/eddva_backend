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
};

@Injectable()
export class GradingService {
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
      default:
        isCorrect = false;
        break;
    }

    if (question.type === QuestionType.DESCRIPTIVE) {
      return { isCorrect: false, marksAwarded: 0, errorType: ErrorType.CONCEPTUAL };
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
      progress.status = TopicStatus.LOCKED;
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
}
