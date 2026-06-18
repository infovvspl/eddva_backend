import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { CareerService } from './career.service';
import { CareerController } from './career.controller';
import { InterestQuizResult } from './entities/interest-quiz-result.entity';
import { CareerReport } from './entities/career-report.entity';
import { InternalModule } from '../../internal/internal.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InterestQuizResult, CareerReport], 'school'),
    AiBridgeModule,
    InternalModule,
  ],
  controllers: [CareerController],
  providers: [CareerService],
  exports: [CareerService],
})
export class CareerModule {}
