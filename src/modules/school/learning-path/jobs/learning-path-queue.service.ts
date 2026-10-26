import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import {
  LEARNING_PATH_QUEUE,
  ROADMAP_CHAPTER_JOB,
  RoadmapChapterJobData,
  RECOMPUTE_DEBOUNCE_MS,
  RECOMPUTE_STUDENT_JOB,
  RecomputeStudentJobData,
} from '../learning-path.constants';

@Injectable()
export class LearningPathQueueService {
  constructor(
    @InjectQueue(LEARNING_PATH_QUEUE) private readonly queue: Queue<RecomputeStudentJobData | RoadmapChapterJobData>,
  ) {}

  /**
   * One delayed job per student. The jobId makes Bull ignore a second request
   * while the first is still waiting, so a burst of changes becomes one
   * recompute. Finished jobs are removed (successful or not) so the next change
   * can queue again; failures are logged by the processor.
   */
  async enqueueRecompute(studentIds: string[], delayMs = RECOMPUTE_DEBOUNCE_MS): Promise<number> {
    const unique = [...new Set(studentIds.filter(Boolean).map(String))];
    if (!unique.length) return 0;
    await this.queue.addBulk(
      unique.map((studentId) => ({
        name: RECOMPUTE_STUDENT_JOB,
        data: { studentId },
        opts: {
          jobId: `recompute:${studentId}`,
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
    return unique.length;
  }

  /**
   * One job per chapter roadmap or topic roadmap (one AI call each). The jobId
   * drops repeat requests while one is queued; failures are counted on the
   * roadmap row, so the job itself is not retried.
   */
  async enqueueRoadmaps(items: RoadmapChapterJobData[]): Promise<number> {
    if (!items.length) return 0;
    await this.queue.addBulk(
      items.map((data) => ({
        name: ROADMAP_CHAPTER_JOB,
        data,
        opts: {
          jobId: data.kind === 'chapter' ? `roadmap:chapter:${data.chapterId}` : `roadmap:topic:${data.topicId}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      })) as any,
    );
    return items.length;
  }
}
