import { Injectable, Logger } from '@nestjs/common';
import { ConceptAccuracy } from '../engine/mastery-engine';

export interface QuizFinalizedEvent {
  studentId: string;
  instanceId: string;
  threadId: string | null;
  stepId: string | null;
  kind: 'quiz' | 'assessment';
  round: number;
  topicId: string;
  accuracy: number;
  weakConcepts: ConceptAccuracy[];
}

type Handler = (event: QuizFinalizedEvent) => Promise<void>;

/**
 * In-process notification that a quiz or assessment was graded, so the quiz
 * engine does not depend on the thread service that also creates its quizzes.
 * Handlers run after the grading transaction has committed; a failing handler
 * is logged and never undoes or fails the grading.
 */
@Injectable()
export class LearningEventsService {
  private readonly logger = new Logger(LearningEventsService.name);
  private readonly handlers: Handler[] = [];

  onQuizFinalized(handler: Handler): void {
    this.handlers.push(handler);
  }

  async quizFinalized(event: QuizFinalizedEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (err) {
        this.logger.error(`quizFinalized handler failed for ${event.instanceId}: ${(err as Error)?.message}`);
      }
    }
  }
}
