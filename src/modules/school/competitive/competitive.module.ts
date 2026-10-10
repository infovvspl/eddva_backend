import { Module } from '@nestjs/common';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { UploadModule } from '../../upload/upload.module';
import { CompetitiveMasterController } from './competitive-master.controller';
import { CompetitiveMasterService } from './competitive-master.service';
import { CompetitiveSubjectController } from './competitive-subject.controller';
import { CompetitiveSubjectService } from './competitive-subject.service';
import { CompetitiveAssignmentController } from './competitive-assignment.controller';
import { CompetitiveAssignmentService } from './competitive-assignment.service';
import { CompetitiveStudentController } from './competitive-student.controller';
import { CompetitiveStudentService } from './competitive-student.service';
import { CompetitiveFeatureGuard } from './competitive-feature.guard';

/**
 * The "Competitive Exam Prep" vertical — see
 * modules/school/migrations/1790400000000-CreateCompetitiveVertical.ts for
 * the data model and C:\Users\HP\.claude\plans\sharded-tickling-ullman.md
 * for the full design.
 *
 * Deliberately its own module with its own tables: no dependency on the
 * existing `school-subject`/`school-teacher` modules, and no dependency on
 * the separate "coaching" vertical at all.
 */
@Module({
  imports: [AiBridgeModule, UploadModule],
  controllers: [CompetitiveMasterController, CompetitiveSubjectController, CompetitiveAssignmentController, CompetitiveStudentController],
  providers: [CompetitiveMasterService, CompetitiveSubjectService, CompetitiveAssignmentService, CompetitiveStudentService, CompetitiveFeatureGuard],
  exports: [CompetitiveMasterService, CompetitiveSubjectService, CompetitiveAssignmentService, CompetitiveStudentService],
})
export class CompetitiveModule {}
