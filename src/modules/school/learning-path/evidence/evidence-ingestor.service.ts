import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DERIVED_SOURCES } from '../engine/mastery-config';
import { insertRows } from '../common/sql-batch';
import { StudentCurriculumRepository, StudentIdentity } from '../common/student-curriculum.repository';
import { EVIDENCE_LOOKBACK_DAYS } from '../learning-path.constants';
import {
  EvidenceDraft,
  evidenceDedupeKey,
  mapAssessmentResult,
  mapAssignmentAnswers,
  mapAssignmentTotals,
  mapGameScore,
  mapLegacyQuizAttempt,
  mergeDrafts,
} from './evidence.mapper';

const EVIDENCE_COLUMNS = [
  'institute_id', 'student_id', 'subject_id', 'chapter_id', 'topic_id', 'concept_tag',
  'source', 'source_ref_id', 'dedupe_key', 'correct', 'total', 'pct', 'occurred_at',
];

/**
 * Turns assessment results, graded assignments, games and old-planner quiz
 * attempts into student_topic_evidence. Read-only towards those modules: it
 * never writes to their tables, and nothing in them has to call it.
 */
@Injectable()
export class EvidenceIngestorService {

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly curriculum: StudentCurriculumRepository,
  ) {}

  /**
   * Replace the student's derived evidence with a fresh read of every source,
   * in one transaction. Idempotent: running it twice gives the same rows, and
   * a deleted or corrected result disappears or changes on the next run.
   */
  async rebuildDerivedEvidence(student: StudentIdentity): Promise<number> {
    const drafts = [
      ...(await this.readAssessments(student)),
      ...(await this.readAssignments(student)),
      ...(await this.readGames(student)),
      ...(await this.readLegacyQuizAttempts(student)),
    ];
    // Several recorded topics of one result can land on the same roadmap topic (or chapter): merged, not dropped.
    const resolved = mergeDrafts(await this.resolveCurriculumIds(drafts));

    const rows: unknown[][] = [];
    for (const d of resolved) {
      const key = evidenceDedupeKey(d);
      rows.push([
        student.instituteId, student.studentId, d.subjectId, d.chapterId, d.topicId, d.conceptTag,
        d.source, d.sourceRefId, key, d.correct, d.total, d.pct, d.occurredAt,
      ]);
    }

    await this.ds.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM student_topic_evidence WHERE student_id::text = $1::text AND source = ANY($2::text[])`,
        [student.studentId, DERIVED_SOURCES],
      );
      await insertRows(manager, 'student_topic_evidence', EVIDENCE_COLUMNS, rows, 'ON CONFLICT (student_id, dedupe_key) DO NOTHING');
    });
    return rows.length;
  }

  private async readAssessments(student: StudentIdentity): Promise<EvidenceDraft[]> {
    const rows = await this.ds.query(
      `SELECT r.id AS result_id, a.subject_id, a.chapter_id, a.chapter_ids, a.topic_id,
              r.percentage, r.marks_obtained, r.total_marks,
              COALESCE(a.scheduled_date, r.updated_at, r.created_at) AS occurred_at,
              sub.grading_details, a.questions_json
         FROM results r
         JOIN assessments a ON a.id::text = r.assessment_id::text
         LEFT JOIN assessment_submissions sub
           ON sub.assessment_id::text = r.assessment_id::text
          AND sub.student_user_id::text = r.student_id::text
        WHERE r.student_id::text = $1::text
          AND r.status = 'published'
          AND r.is_absent = false
          AND COALESCE(a.scheduled_date, r.updated_at, r.created_at) >= NOW() - make_interval(days => $2)`,
      [student.userId, EVIDENCE_LOOKBACK_DAYS],
    );
    return rows.flatMap(mapAssessmentResult);
  }

  /**
   * Individual submissions only: a group submission's marks say nothing
   * reliable about any one member. A question without a topic_id is matched
   * by name, exactly as the migration's backfill does, and only when one topic
   * of the subject matches.
   */
  private async readAssignments(student: StudentIdentity): Promise<EvidenceDraft[]> {
    if (!(await this.curriculum.tableExists('assignment_answers'))) return [];
    const rows = await this.ds.query(
      `SELECT sub.id AS submission_id, a.subject_id,
              COALESCE(q.topic_id::text, m.topic_id) AS topic_id,
              q.marks AS question_marks, ans.is_correct, ans.marks_awarded,
              sub.updated_at AS occurred_at
         FROM assignment_submissions sub
         JOIN assignments a ON a.id::text = sub.assignment_id::text
         JOIN assignment_answers ans ON ans.submission_id::text = sub.id::text
         JOIN assignment_questions q ON q.id::text = ans.question_id::text
         LEFT JOIN LATERAL (
           SELECT CASE WHEN COUNT(DISTINCT t.id) = 1 THEN MIN(t.id::text) END AS topic_id
             FROM chapters c
             JOIN topics t ON t.chapter_id::text = c.id::text
            WHERE c.subject_id::text = a.subject_id::text
              AND learning_norm_name(t.name) = learning_norm_name(q.topic_name)
         ) m ON q.topic_id IS NULL AND learning_norm_name(q.topic_name) IS NOT NULL
        WHERE sub.student_id::text = $1::text
          AND sub.status = 'graded'
          AND sub.group_id IS NULL
          AND sub.updated_at >= NOW() - make_interval(days => $2)`,
      [student.studentId, EVIDENCE_LOOKBACK_DAYS],
    );
    // Teacher-graded written work has one total mark and no per-question answers.
    const totals = await this.ds.query(
      `SELECT sub.id AS submission_id, a.subject_id, COALESCE(q.topic_id::text, m.topic_id) AS topic_id,
              q.marks AS question_marks, sub.marks AS submission_marks, a.max_marks,
              sub.updated_at AS occurred_at
         FROM assignment_submissions sub
         JOIN assignments a ON a.id::text = sub.assignment_id::text
         JOIN assignment_questions q ON q.assignment_id::text = a.id::text
         LEFT JOIN LATERAL (
           SELECT CASE WHEN COUNT(DISTINCT t.id) = 1 THEN MIN(t.id::text) END AS topic_id
             FROM chapters c
             JOIN topics t ON t.chapter_id::text = c.id::text
            WHERE c.subject_id::text = a.subject_id::text
              AND learning_norm_name(t.name) = learning_norm_name(q.topic_name)
         ) m ON q.topic_id IS NULL AND learning_norm_name(q.topic_name) IS NOT NULL
        WHERE sub.student_id::text = $1::text
          AND sub.status = 'graded'
          AND sub.group_id IS NULL
          AND sub.marks IS NOT NULL
          AND sub.updated_at >= NOW() - make_interval(days => $2)
          AND NOT EXISTS (SELECT 1 FROM assignment_answers ans WHERE ans.submission_id::text = sub.id::text)`,
      [student.studentId, EVIDENCE_LOOKBACK_DAYS],
    );
    return [...mapAssignmentAnswers(rows), ...mapAssignmentTotals(totals)];
  }

  /** Completed games that were not flagged for cheating. Read only; gamification code is untouched. */
  private async readGames(student: StudentIdentity): Promise<EvidenceDraft[]> {
    if (!(await this.curriculum.tableExists('school_game_scores'))) return [];
    const rows = await this.ds.query(
      `SELECT sc.id AS score_id, s.subject_id, s.chapter_id,
              sc.total_questions, sc.correct_answers, sc.created_at AS occurred_at
         FROM school_game_scores sc
         JOIN school_game_sessions s ON s.id = sc.session_id
        WHERE sc.student_user_id::text = $1::text
          AND s.status = 'completed'
          AND COALESCE(s.cheat_flagged, false) = false
          AND s.chapter_id IS NOT NULL
          AND sc.created_at >= NOW() - make_interval(days => $2)`,
      [student.userId, EVIDENCE_LOOKBACK_DAYS],
    );
    return rows.map(mapGameScore).filter(Boolean) as EvidenceDraft[];
  }

  private async readLegacyQuizAttempts(student: StudentIdentity): Promise<EvidenceDraft[]> {
    if (!(await this.curriculum.tableExists('learning_legacy_quiz_attempts'))) return [];
    const rows = await this.ds.query(
      `SELECT id AS attempt_id, topic_id, accuracy, created_at AS occurred_at
         FROM learning_legacy_quiz_attempts
        WHERE student_id::text = $1::text
          AND created_at >= NOW() - make_interval(days => $2)`,
      [student.studentId, EVIDENCE_LOOKBACK_DAYS],
    );
    return rows.map(mapLegacyQuizAttempt).filter(Boolean) as EvidenceDraft[];
  }

  /**
   * Sources tag scores with the school's recorded topics. Each is moved onto
   * the roadmap topic that covers it (learning_roadmap_topic_links); a
   * recorded topic no roadmap covers keeps its own id, so it is judged on its
   * own and can get a topic roadmap once weak. Chapter and subject come from
   * the curriculum; drafts pointing at a deleted topic or chapter are dropped.
   */
  private async resolveCurriculumIds(drafts: EvidenceDraft[]): Promise<EvidenceDraft[]> {
    const topicIds = [...new Set(drafts.filter((d) => d.topicId).map((d) => d.topicId!))];
    const chapterIds = [...new Set(drafts.filter((d) => !d.topicId && d.chapterId).map((d) => d.chapterId!))];

    const topicRows = topicIds.length
      ? await this.ds.query(
          `SELECT t.id::text AS topic_id, c.id::text AS chapter_id, c.subject_id::text AS subject_id,
                  l.roadmap_topic_id::text AS roadmap_topic_id
             FROM topics t
             JOIN chapters c ON c.id::text = t.chapter_id::text
             LEFT JOIN learning_roadmap_topic_links l ON l.curriculum_topic_id = t.id
            WHERE t.id::text = ANY($1::text[])`,
          [topicIds],
        )
      : [];
    const chapterRows = chapterIds.length
      ? await this.ds.query(
          `SELECT id::text AS chapter_id, subject_id::text AS subject_id FROM chapters WHERE id::text = ANY($1::text[])`,
          [chapterIds],
        )
      : [];
    const topicMap = new Map<string, { chapter_id: string; subject_id: string; roadmap_topic_id: string | null }>(
      topicRows.map((r: any) => [r.topic_id, r]),
    );
    const chapterMap = new Map<string, string>(chapterRows.map((r: any) => [r.chapter_id, r.subject_id]));

    const out: EvidenceDraft[] = [];
    for (const d of drafts) {
      if (d.topicId) {
        const t = topicMap.get(d.topicId);
        if (!t) continue;
        out.push({ ...d, topicId: t.roadmap_topic_id ?? d.topicId, chapterId: t.chapter_id, subjectId: t.subject_id });
      } else {
        const subjectId = chapterMap.get(d.chapterId!);
        if (!subjectId) continue;
        out.push({ ...d, subjectId });
      }
    }
    return out;
  }
}
