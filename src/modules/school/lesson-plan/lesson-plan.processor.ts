import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { LessonPlanService } from './lesson-plan.service';
import { LESSON_PLAN_GENERATE_JOB, LESSON_PLAN_QUEUE, LessonPlanJobData } from './lesson-plan.constants';

/**
 * One chapter at a time. Each plan is a long AI call in the background AI pool,
 * which admits one call per school at a time: running two here only made the
 * second wait out its 60 s admission budget and fail ("at capacity").
 */
@Processor(LESSON_PLAN_QUEUE)
export class LessonPlanProcessor {
  private readonly logger = new Logger(LessonPlanProcessor.name);

  constructor(private readonly svc: LessonPlanService) {}

  @Process({ name: LESSON_PLAN_GENERATE_JOB, concurrency: 1 })
  async generate(job: Job<LessonPlanJobData>) {
    this.logger.log(`Generating lesson plan ${job.data.planId}`);
    // runGeneration records a failure on the plan itself (FAILED + reason) for the teacher to retry.
    await this.svc.runGeneration(job.data.planId, job.data.deferrals ?? 0);
  }
}
