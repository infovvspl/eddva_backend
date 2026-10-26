import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { insertRows } from '../common/sql-batch';
import { LearningPathSettingsService } from '../common/learning-path-settings.service';
import { StudentCurriculumRepository, StudentIdentity } from '../common/student-curriculum.repository';
import { EvidenceIngestorService } from '../evidence/evidence-ingestor.service';
import { computeChapterMastery, computeStudentMastery, EvidenceItem } from '../engine/mastery-engine';
import { EvidenceSource } from '../engine/mastery-config';

const TOPIC_COLUMNS = [
  'student_id', 'topic_id', 'institute_id', 'subject_id', 'chapter_id', 'mastery', 'confidence',
  'status', 'est_minutes', 'evidence_count', 'last_evidence_at', 'updated_at',
];
const CHAPTER_COLUMNS = [
  'student_id', 'chapter_id', 'institute_id', 'subject_id', 'mastery', 'confidence', 'status',
  'est_minutes', 'evidence_count', 'weak_topics', 'at_risk_topics', 'chapter_level_status', 'last_evidence_at', 'updated_at',
];

export interface RecomputeOutcome {
  studentId: string;
  evidence: number;
  topics: number;
  weakTopics: number;
  atRiskTopics: number;
  weakChapters: number;
}

@Injectable()
export class MasteryService {
  private readonly logger = new Logger(MasteryService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly curriculum: StudentCurriculumRepository,
    private readonly ingestor: EvidenceIngestorService,
    private readonly settings: LearningPathSettingsService,
  ) {}

  /** Re-read every source for the student, then recompute and store topic and chapter mastery. */
  async refreshStudent(studentId: string, now = new Date()): Promise<RecomputeOutcome | null> {
    const student = await this.curriculum.findStudent(studentId);
    if (!student) {
      // The student was removed: their derived rows must not linger in reports.
      await this.deleteStudentRows(studentId);
      return null;
    }
    const evidence = await this.ingestor.rebuildDerivedEvidence(student);
    const outcome = await this.recompute(student, now);
    return { ...outcome, evidence };
  }

  async recompute(student: StudentIdentity, now = new Date()): Promise<Omit<RecomputeOutcome, 'evidence'>> {
    const [cfg, { topics, chapters }, studied, evidence] = await Promise.all([
      this.settings.getMasteryConfig(student.instituteId),
      this.curriculum.loadCurriculum(student),
      this.curriculum.studiedTopicIds(student.studentId),
      this.loadEvidence(student.studentId),
    ]);

    const topicRefs = topics.map((t) => ({ ...t, neverStudied: !studied.has(t.topicId) }));
    const topicResults = computeStudentMastery(topicRefs, evidence, cfg, now);
    const chapterResults = computeChapterMastery(chapters, topicResults, evidence, cfg, now);

    await this.ds.transaction(async (manager) => {
      await manager.query(`DELETE FROM student_topic_mastery WHERE student_id::text = $1::text`, [student.studentId]);
      await manager.query(`DELETE FROM student_chapter_mastery WHERE student_id::text = $1::text`, [student.studentId]);
      await insertRows(
        manager,
        'student_topic_mastery',
        TOPIC_COLUMNS,
        topicResults.map((t) => [
          student.studentId, t.topicId, student.instituteId, t.subjectId, t.chapterId, t.mastery, t.confidence,
          t.status, t.estMinutes, t.evidenceCount, t.lastEvidenceAt, now,
        ]),
      );
      await insertRows(
        manager,
        'student_chapter_mastery',
        CHAPTER_COLUMNS,
        chapterResults.map((c) => [
          student.studentId, c.chapterId, student.instituteId, c.subjectId, c.mastery, c.confidence, c.status,
          c.estMinutes, c.evidenceCount, c.weakTopics, c.atRiskTopics, c.chapterLevelStatus, c.lastEvidenceAt, now,
        ]),
      );
    });

    return {
      studentId: student.studentId,
      topics: topicResults.length,
      weakTopics: topicResults.filter((t) => t.status === 'weak').length,
      atRiskTopics: topicResults.filter((t) => t.status === 'at_risk').length,
      weakChapters: chapterResults.filter((c) => c.status === 'weak').length,
    };
  }

  private async loadEvidence(studentId: string): Promise<EvidenceItem[]> {
    const rows = await this.ds.query(
      `SELECT source, topic_id, chapter_id, concept_tag, pct, total, occurred_at
         FROM student_topic_evidence
        WHERE student_id::text = $1::text`,
      [studentId],
    );
    return rows.map((r: any) => ({
      source: r.source as EvidenceSource,
      topicId: r.topic_id ? String(r.topic_id) : null,
      chapterId: r.chapter_id ? String(r.chapter_id) : null,
      conceptTag: r.concept_tag ?? null,
      pct: Number(r.pct),
      total: r.total === null ? null : Number(r.total),
      occurredAt: new Date(r.occurred_at),
    }));
  }

  private async deleteStudentRows(studentId: string): Promise<void> {
    this.logger.log(`Student ${studentId} no longer exists; removing their learning-path rows`);
    await this.ds.transaction(async (manager) => {
      for (const table of ['student_topic_evidence', 'student_topic_mastery', 'student_chapter_mastery']) {
        await manager.query(`DELETE FROM ${table} WHERE student_id::text = $1::text`, [studentId]);
      }
    });
  }
}
