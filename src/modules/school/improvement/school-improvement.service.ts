import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolSyllabusService } from '../syllabus/school-syllabus.service';

const SCORE_THRESHOLD = 60; // section/subject AVERAGES, so pitched above the 50% individual-student flag threshold

@Injectable()
export class SchoolImprovementService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly syllabusService: SchoolSyllabusService,
  ) {}

  private async resolveAttendanceThreshold(instituteId: string): Promise<number> {
    const rows = await this.ds.query(`SELECT min_attendance_percentage FROM institutes WHERE id=$1`, [instituteId]);
    return Number(rows[0]?.min_attendance_percentage) || 75;
  }

  async getImprovementAreas(user: any) {
    const instituteId = user.instituteId;
    const attendanceThreshold = await this.resolveAttendanceThreshold(instituteId);

    const [weakSections, weakSubjects, teacherAttendanceGaps, feeHealth, syllabusResult, trends, sectionsRanking, subjectsRanking, teachersRanking] = await Promise.all([
      this.getWeakSections(instituteId, attendanceThreshold),
      this.getWeakSubjects(instituteId),
      this.getTeacherAttendanceGaps(instituteId, attendanceThreshold),
      this.getFeeHealth(instituteId),
      this.syllabusService.getSyllabusTracker(user, {}).catch(() => ({ tracker: [] })),
      this.getTrends(instituteId).catch(() => []),
      this.getSectionsRanking(instituteId, attendanceThreshold).catch(() => []),
      this.getSubjectsRanking(instituteId).catch(() => []),
      this.getTeachersRanking(instituteId, attendanceThreshold).catch(() => []),
    ]);

    // getSyllabusTracker doesn't return a teacher_user_id (only a display name), so
    // "behind schedule" counts are correlated to the attendance rows by name — a
    // best-effort match, not a hard join; good enough for a dashboard rollup.
    const behindByName = new Map<string, number>();
    for (const row of (syllabusResult as any).tracker || []) {
      if (row.status === 'BEHIND' && row.teacherName && row.teacherName !== 'Unassigned') {
        behindByName.set(row.teacherName, (behindByName.get(row.teacherName) || 0) + 1);
      }
    }
    const attendanceNames = new Set(teacherAttendanceGaps.map((t: any) => t.name));
    const teacherGaps = [
      ...teacherAttendanceGaps.map((t: any) => ({ ...t, behindSyllabusCount: behindByName.get(t.name) || 0 })),
      ...[...behindByName.entries()]
        .filter(([name]) => !attendanceNames.has(name))
        .map(([name, behindSyllabusCount]) => ({ teacherUserId: null, name, attendancePct: null, behindSyllabusCount })),
    ].sort((a, b) => (a.attendancePct ?? 101) - (b.attendancePct ?? 101) || b.behindSyllabusCount - a.behindSyllabusCount);

    const teachersRankingWithSyllabus = (teachersRanking as any[])
      .map((t) => ({ ...t, behindSyllabusCount: behindByName.get(t.name) || 0 }))
      .sort((a, b) => a.attendancePct - b.attendancePct);

    const rankings = {
      sections: sectionsRanking,
      subjects: subjectsRanking,
      teachers: teachersRankingWithSyllabus,
    };

    return { success: true, attendanceThreshold, weakSections, weakSubjects, teacherGaps, feeHealth, trends, rankings };
  }

  /** Sections below the attendance threshold OR below the school-wide weak-score bar, worst first. */
  private async getWeakSections(instituteId: string, attendanceThreshold: number) {
    return this.ds.query(
      `
      WITH att AS (
        SELECT sec.id AS section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name,
               ROUND(100.0 * COUNT(*) FILTER (WHERE LOWER(a.status) IN ('present','late')) / NULLIF(COUNT(*), 0))::int AS "attendancePct"
        FROM attendances a
        JOIN users u ON u.id = a.user_id AND u.role = 'STUDENT'
        JOIN students s ON s.user_id = u.id
        JOIN sections sec ON sec.id = s.section_id
        JOIN classes c ON c.id = sec.class_id
        WHERE a.institute_id = $1 AND a.date >= CURRENT_DATE - 30
        GROUP BY sec.id, sec.name, c.id, c.name
      ),
      score AS (
        SELECT sec.id AS section_id,
               ROUND(AVG(r.marks_obtained::numeric / NULLIF(asm.total_marks, 0) * 100))::int AS "avgScore"
        FROM results r
        JOIN assessments asm ON asm.id = r.assessment_id
        JOIN students s ON s.user_id = r.student_id
        JOIN sections sec ON sec.id = s.section_id
        WHERE s.institute_id::text = $1::text AND COALESCE(r.is_absent, false) = false
        GROUP BY sec.id
      )
      SELECT att.section_id AS "sectionId", att.section_name AS "sectionName",
             att.class_id AS "classId", att.class_name AS "className",
             att."attendancePct", score."avgScore",
             ARRAY_REMOVE(ARRAY[
               CASE WHEN att."attendancePct" < $2 THEN 'ATTENDANCE' END,
               CASE WHEN score."avgScore" IS NOT NULL AND score."avgScore" < ${SCORE_THRESHOLD} THEN 'SCORE' END
             ], NULL) AS reasons
      FROM att LEFT JOIN score ON score.section_id = att.section_id
      WHERE att."attendancePct" < $2 OR (score."avgScore" IS NOT NULL AND score."avgScore" < ${SCORE_THRESHOLD})
      ORDER BY LEAST(att."attendancePct", COALESCE(score."avgScore", 100)) ASC
      LIMIT 20
      `,
      [instituteId, attendanceThreshold],
    );
  }

  /** Subjects averaging below the weak-score bar school-wide, worst first. */
  private async getWeakSubjects(instituteId: string) {
    return this.ds.query(
      `
      SELECT sub.id AS "subjectId", sub.name AS "subjectName",
             ROUND(AVG(r.marks_obtained::numeric / NULLIF(asm.total_marks, 0) * 100))::int AS "avgScore",
             COUNT(*) FILTER (WHERE (r.marks_obtained::numeric / NULLIF(asm.total_marks, 0) * 100) < 50)::int AS "studentsBelowThreshold"
      FROM results r
      JOIN assessments asm ON asm.id = r.assessment_id
      JOIN subjects sub ON sub.id = asm.subject_id
      JOIN users u ON u.id = r.student_id
      WHERE u.institute_id::text = $1::text AND COALESCE(r.is_absent, false) = false AND asm.subject_id IS NOT NULL
      GROUP BY sub.id, sub.name
      HAVING AVG(r.marks_obtained::numeric / NULLIF(asm.total_marks, 0) * 100) < ${SCORE_THRESHOLD}
      ORDER BY "avgScore" ASC
      LIMIT 20
      `,
      [instituteId],
    );
  }

  /** Teachers below the attendance threshold over the last 30 days, worst first. */
  private async getTeacherAttendanceGaps(instituteId: string, attendanceThreshold: number) {
    return this.ds.query(
      `
      SELECT u.id AS "teacherUserId", u.name,
             ROUND(100.0 * COUNT(*) FILTER (WHERE ta.status IN ('present', 'late')) / NULLIF(COUNT(*), 0))::int AS "attendancePct"
      FROM teacher_attendance ta
      JOIN users u ON u.id = ta.teacher_user_id
      WHERE ta.institute_id::text = $1::text AND ta.date >= (CURRENT_DATE - 30)::text
      GROUP BY u.id, u.name
      HAVING 100.0 * COUNT(*) FILTER (WHERE ta.status IN ('present', 'late')) / NULLIF(COUNT(*), 0) < $2
      ORDER BY "attendancePct" ASC
      LIMIT 20
      `,
      [instituteId, attendanceThreshold],
    );
  }

  /** School-wide collection rate plus the worst-collecting sections, so chronic-defaulter cohorts stand out. */
  private async getFeeHealth(instituteId: string) {
    const [totals, bySection] = await Promise.all([
      this.ds.query(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE UPPER(status::text) = 'PAID'), 0)::float AS collected,
                COALESCE(SUM(amount), 0)::float AS total
         FROM fees WHERE institute_id = $1`,
        [instituteId],
      ),
      this.ds.query(
        `
        SELECT c.id AS "classId", c.name AS "className", sec.id AS "sectionId", sec.name AS "sectionName",
               ROUND(100.0 * COALESCE(SUM(f.amount) FILTER (WHERE UPPER(f.status::text) = 'PAID'), 0)
                     / NULLIF(SUM(f.amount), 0))::int AS "collectionRatePct",
               COUNT(DISTINCT f.student_id) FILTER (WHERE UPPER(f.status::text) != 'PAID' AND f.due_date IS NOT NULL AND f.due_date < CURRENT_DATE)::int AS "overdueAccounts",
               COALESCE(SUM(f.amount) FILTER (WHERE UPPER(f.status::text) != 'PAID' AND f.due_date IS NOT NULL AND f.due_date < CURRENT_DATE), 0)::int AS "overdueAmount"
        FROM fees f
        JOIN students s ON s.id = f.student_id
        JOIN sections sec ON sec.id = s.section_id
        JOIN classes c ON c.id = sec.class_id
        WHERE f.institute_id = $1
        GROUP BY c.id, c.name, sec.id, sec.name
        HAVING SUM(f.amount) > 0
        ORDER BY "collectionRatePct" ASC NULLS FIRST
        LIMIT 20
        `,
        [instituteId],
      ),
    ]);
    const t = totals[0] || { collected: 0, total: 0 };
    const schoolCollectionRatePct = t.total > 0 ? Math.round((t.collected / t.total) * 100) : 0;
    return { schoolCollectionRatePct, bySection };
  }

  /** School-wide attendance / avg. score / fee collection rate, by month, last 6 months. */
  private async getTrends(instituteId: string) {
    return this.ds.query(
      `
      WITH months AS (
        SELECT generate_series(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months', DATE_TRUNC('month', CURRENT_DATE), INTERVAL '1 month') AS m
      ),
      att AS (
        SELECT DATE_TRUNC('month', date) AS m,
               ROUND(100.0 * COUNT(*) FILTER (WHERE LOWER(status) IN ('present','late')) / NULLIF(COUNT(*), 0))::int AS attendance_pct
        FROM attendances
        WHERE institute_id::text = $1 AND date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
        GROUP BY 1
      ),
      score AS (
        SELECT DATE_TRUNC('month', COALESCE(a.scheduled_date, r.created_at)) AS m,
               ROUND(AVG(r.percentage))::int AS avg_score_pct
        FROM results r
        JOIN users u ON u.id::text = r.student_id::text
        LEFT JOIN assessments a ON a.id = r.assessment_id
        WHERE u.institute_id::text = $1 AND COALESCE(r.is_absent, false) = false
          AND COALESCE(a.scheduled_date, r.created_at) >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
        GROUP BY 1
      ),
      fee AS (
        SELECT DATE_TRUNC('month', due_date) AS m,
               ROUND(100.0 * COALESCE(SUM(amount) FILTER (WHERE UPPER(status::text) = 'PAID'), 0) / NULLIF(SUM(amount), 0))::int AS fee_rate_pct
        FROM fees
        WHERE institute_id::text = $1 AND due_date IS NOT NULL
          AND due_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
        GROUP BY 1
      )
      SELECT TO_CHAR(months.m, 'Mon') AS month,
             att.attendance_pct AS "attendancePct",
             score.avg_score_pct AS "avgScorePct",
             fee.fee_rate_pct AS "feeCollectionRatePct"
      FROM months
      LEFT JOIN att ON att.m = months.m
      LEFT JOIN score ON score.m = months.m
      LEFT JOIN fee ON fee.m = months.m
      ORDER BY months.m
      `,
      [instituteId],
    );
  }

  /** Every section, best to worst — the comparative ranking behind the Weak Sections flag list. */
  private async getSectionsRanking(instituteId: string, attendanceThreshold: number) {
    return this.ds.query(
      `
      WITH att AS (
        SELECT sec.id AS section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name,
               ROUND(100.0 * COUNT(*) FILTER (WHERE LOWER(a.status) IN ('present','late')) / NULLIF(COUNT(*), 0))::int AS "attendancePct"
        FROM attendances a
        JOIN users u ON u.id = a.user_id AND u.role = 'STUDENT'
        JOIN students s ON s.user_id = u.id
        JOIN sections sec ON sec.id = s.section_id
        JOIN classes c ON c.id = sec.class_id
        WHERE a.institute_id = $1 AND a.date >= CURRENT_DATE - 30
        GROUP BY sec.id, sec.name, c.id, c.name
      ),
      score AS (
        SELECT sec.id AS section_id,
               ROUND(AVG(r.marks_obtained::numeric / NULLIF(asm.total_marks, 0) * 100))::int AS "avgScore"
        FROM results r
        JOIN assessments asm ON asm.id = r.assessment_id
        JOIN students s ON s.user_id = r.student_id
        JOIN sections sec ON sec.id = s.section_id
        WHERE s.institute_id::text = $1::text AND COALESCE(r.is_absent, false) = false
        GROUP BY sec.id
      )
      SELECT att.section_id AS "sectionId", att.section_name AS "sectionName",
             att.class_id AS "classId", att.class_name AS "className",
             att."attendancePct", score."avgScore",
             (att."attendancePct" < $2 OR (score."avgScore" IS NOT NULL AND score."avgScore" < ${SCORE_THRESHOLD})) AS "isWeak"
      FROM att LEFT JOIN score ON score.section_id = att.section_id
      ORDER BY LEAST(att."attendancePct", COALESCE(score."avgScore", 100)) ASC
      LIMIT 100
      `,
      [instituteId, attendanceThreshold],
    );
  }

  /** Every subject, best to worst — the comparative ranking behind the Weak Subjects flag list. */
  private async getSubjectsRanking(instituteId: string) {
    return this.ds.query(
      `
      SELECT sub.id AS "subjectId", sub.name AS "subjectName",
             ROUND(AVG(r.marks_obtained::numeric / NULLIF(asm.total_marks, 0) * 100))::int AS "avgScore",
             COUNT(*) FILTER (WHERE (r.marks_obtained::numeric / NULLIF(asm.total_marks, 0) * 100) < 50)::int AS "studentsBelowThreshold",
             (AVG(r.marks_obtained::numeric / NULLIF(asm.total_marks, 0) * 100) < ${SCORE_THRESHOLD}) AS "isWeak"
      FROM results r
      JOIN assessments asm ON asm.id = r.assessment_id
      JOIN subjects sub ON sub.id = asm.subject_id
      JOIN users u ON u.id = r.student_id
      WHERE u.institute_id::text = $1::text AND COALESCE(r.is_absent, false) = false AND asm.subject_id IS NOT NULL
      GROUP BY sub.id, sub.name
      ORDER BY "avgScore" ASC
      LIMIT 100
      `,
      [instituteId],
    );
  }

  /** Every teacher with recent attendance records, best to worst. */
  private async getTeachersRanking(instituteId: string, attendanceThreshold: number) {
    return this.ds.query(
      `
      SELECT u.id AS "teacherUserId", u.name,
             ROUND(100.0 * COUNT(*) FILTER (WHERE ta.status IN ('present', 'late')) / NULLIF(COUNT(*), 0))::int AS "attendancePct",
             (100.0 * COUNT(*) FILTER (WHERE ta.status IN ('present', 'late')) / NULLIF(COUNT(*), 0) < $2) AS "isWeak"
      FROM teacher_attendance ta
      JOIN users u ON u.id = ta.teacher_user_id
      WHERE ta.institute_id::text = $1::text AND ta.date >= (CURRENT_DATE - 30)::text
      GROUP BY u.id, u.name
      ORDER BY "attendancePct" ASC
      LIMIT 100
      `,
      [instituteId, attendanceThreshold],
    );
  }
}
