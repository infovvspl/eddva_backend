import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { MasteryService } from '../mastery/mastery.service';
import { RoadmapService } from '../roadmap/roadmap.service';
import {
  LEARNING_PATH_QUEUE,
  ROADMAP_CHAPTER_JOB,
  RoadmapChapterJobData,
  RECOMPUTE_STUDENT_JOB,
  RecomputeStudentJobData,
} from '../learning-path.constants';

@Processor(LEARNING_PATH_QUEUE)
export class LearningPathProcessor {
  private readonly logger = new Logger(LearningPathProcessor.name);

  constructor(
    private readonly mastery: MasteryService,
    private readonly roadmaps: RoadmapService,
  ) {}

  @Process({ name: RECOMPUTE_STUDENT_JOB, concurrency: 2 })
  async recompute(job: Job<RecomputeStudentJobData>) {
    const { studentId } = job.data;
    try {
      return await this.mastery.refreshStudent(studentId);
    } catch (err) {
      this.logger.error(
        `Mastery recompute failed for ${studentId} (attempt ${job.attemptsMade + 1}): ${(err as Error)?.message}`,
      );
      throw err; // Bull retries with backoff
    }
  }

  /** One AI call per chapter; kept to one at a time so a burst of new weak chapters does not flood the AI service. */
  @Process({ name: ROADMAP_CHAPTER_JOB, concurrency: 1 })
  async roadmap(job: Job<RoadmapChapterJobData>) {
    const { kind, chapterId, topicId, instituteId, className } = job.data;
    try {
      if (kind === 'topic' && topicId) await this.roadmaps.generateForTopic(chapterId, topicId, instituteId, className);
      else await this.roadmaps.generateForChapter(chapterId, instituteId, className);
    } catch (err) {
      this.logger.error(`Roadmap generation failed (${kind} ${topicId ?? chapterId}): ${(err as Error)?.message}`);
    }
  }
}
