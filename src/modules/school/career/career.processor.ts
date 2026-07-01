import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { CareerService } from './career.service';
import {
  CAREER_REPORT_JOB,
  CAREER_REPORT_QUEUE,
  CareerReportJobData,
} from './career.constants';

@Processor(CAREER_REPORT_QUEUE)
export class CareerReportProcessor {
  private readonly logger = new Logger(CareerReportProcessor.name);

  constructor(private readonly careerService: CareerService) {}

  @Process(CAREER_REPORT_JOB)
  async process(job: Job<CareerReportJobData>) {
    const { studentId, instituteId } = job.data;
    this.logger.log(`Generating career report for student ${studentId}`);
    try {
      await this.careerService.runReportGeneration(studentId, instituteId);
      this.logger.log(`Career report generated for student ${studentId}`);
    } catch (err) {
      this.logger.error(`Career report generation failed for student ${studentId}: ${(err as Error)?.message}`);
      throw err; // Bull will retry based on queue options
    }
  }
}
