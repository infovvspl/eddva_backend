import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hasSchoolRole } from '../../common/role-helper';
import { StudentCurriculumRepository } from '../common/student-curriculum.repository';
import { LearningPathQueueService } from '../jobs/learning-path-queue.service';

const NEEDS_ATTENTION = ['weak', 'at_risk'];

/** Read side of mastery, and the admin trigger for recomputing it. */
@Injectable()
export class MasteryQueryService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly curriculum: StudentCurriculumRepository,
    private readonly queue: LearningPathQueueService,
  ) {}

  /** The signed-in student's weak and at-risk topics and chapters, with study time and evidence counts. */
  async getMyMastery(user: any) {
    const student = await this.curriculum.findStudentByUserId(user.id);
    if (!student) throw new NotFoundException('Student profile not found');

    const [topics, chapters, sources] = await Promise.all([
      this.ds.query(
        `SELECT m.topic_id, TRIM(COALESCE(rt.name, ct.name)) AS topic_name, m.chapter_id, c.name AS chapter_name,
                m.subject_id, s.name AS subject_name,
                m.mastery, m.confidence, m.status, m.est_minutes, m.evidence_count, m.last_evidence_at, m.updated_at
           FROM student_topic_mastery m
           LEFT JOIN learning_roadmap_topics rt ON rt.id = m.topic_id
           LEFT JOIN topics ct ON ct.id = m.topic_id
           JOIN chapters c ON c.id::text = m.chapter_id::text
           JOIN subjects s ON s.id::text = m.subject_id::text
          WHERE m.student_id::text = $1::text AND m.status = ANY($2::text[])
          ORDER BY m.mastery ASC NULLS LAST, m.est_minutes DESC`,
        [student.studentId, NEEDS_ATTENTION],
      ),
      this.ds.query(
        `SELECT m.chapter_id, c.name AS chapter_name, m.subject_id, s.name AS subject_name, m.mastery, m.confidence,
                m.status, m.est_minutes, m.weak_topics, m.at_risk_topics, m.evidence_count
           FROM student_chapter_mastery m
           JOIN chapters c ON c.id::text = m.chapter_id::text
           JOIN subjects s ON s.id::text = m.subject_id::text
          WHERE m.student_id::text = $1::text AND m.status = ANY($2::text[])
          ORDER BY m.mastery ASC NULLS LAST`,
        [student.studentId, NEEDS_ATTENTION],
      ),
      this.ds.query(
        `SELECT source, COUNT(DISTINCT source_ref_id)::int AS count
           FROM student_topic_evidence WHERE student_id::text = $1::text GROUP BY source`,
        [student.studentId],
      ),
    ]);

    // Study time: weak/at-risk topics, plus weak/at-risk chapters none of whose topics is flagged on its own.
    const flaggedChapterIds = new Set(topics.map((t: any) => String(t.chapter_id)));
    const minutes =
      topics.reduce((sum: number, t: any) => sum + Number(t.est_minutes), 0) +
      chapters
        .filter((c: any) => !flaggedChapterIds.has(String(c.chapter_id)))
        .reduce((sum: number, c: any) => sum + Number(c.est_minutes), 0);

    return {
      summary: {
        weakTopics: topics.filter((t: any) => t.status === 'weak').length,
        atRiskTopics: topics.filter((t: any) => t.status === 'at_risk').length,
        weakChapters: chapters.filter((c: any) => c.status === 'weak').length,
        studyMinutes: minutes,
        detectedFrom: Object.fromEntries(sources.map((s: any) => [s.source, s.count])),
        updatedAt: topics[0]?.updated_at ?? null,
      },
      topics: topics.map((t: any) => ({
        topicId: t.topic_id,
        topicName: t.topic_name,
        chapterId: t.chapter_id,
        chapterName: t.chapter_name,
        subjectId: t.subject_id,
        subjectName: t.subject_name,
        mastery: t.mastery === null ? null : Number(t.mastery),
        confidence: Number(t.confidence),
        status: t.status,
        estMinutes: Number(t.est_minutes),
        evidenceCount: Number(t.evidence_count),
        lastEvidenceAt: t.last_evidence_at,
      })),
      chapters: chapters.map((c: any) => ({
        chapterId: c.chapter_id,
        chapterName: c.chapter_name,
        subjectId: c.subject_id,
        subjectName: c.subject_name,
        mastery: c.mastery === null ? null : Number(c.mastery),
        confidence: Number(c.confidence),
        status: c.status,
        estMinutes: Number(c.est_minutes),
        weakTopics: Number(c.weak_topics),
        atRiskTopics: Number(c.at_risk_topics),
        evidenceCount: Number(c.evidence_count),
      })),
    };
  }

  /** Admin: queue one student, or every student of the institute. */
  async queueRecompute(user: any, studentId?: string): Promise<{ queued: number }> {
    if (studentId) {
      const student = await this.curriculum.findStudent(studentId);
      if (!student) throw new NotFoundException('Student not found');
      if (!hasSchoolRole(user.role, 'SUPER_ADMIN') && String(student.instituteId) !== String(user.instituteId)) {
        throw new ForbiddenException('This student belongs to another institute');
      }
      return { queued: await this.queue.enqueueRecompute([student.studentId], 0) };
    }
    if (!user.instituteId) throw new ForbiddenException('No institute on this account');
    const rows = await this.ds.query(`SELECT id::text AS id FROM students WHERE institute_id::text = $1::text`, [
      user.instituteId,
    ]);
    return { queued: await this.queue.enqueueRecompute(rows.map((r: any) => r.id), 0) };
  }
}
