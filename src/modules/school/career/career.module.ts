import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { CareerService } from './career.service';
import { CareerController } from './career.controller';
import { CareerReportProcessor } from './career.processor';
import { InterestQuizResult } from './entities/interest-quiz-result.entity';
import { CareerReport } from './entities/career-report.entity';
import { InternalModule } from '../../internal/internal.module';
import { CAREER_REPORT_QUEUE } from './career.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([InterestQuizResult, CareerReport], 'school'),
    AiBridgeModule,
    InternalModule,
    BullModule.registerQueue({ name: CAREER_REPORT_QUEUE }),
  ],
  controllers: [CareerController],
  providers: [CareerService, CareerReportProcessor],
  exports: [CareerService],
})
export class CareerModule {}
