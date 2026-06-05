import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';

@Injectable()
export class SchoolAssessmentService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
  ) { }

  async list(user: any, query: any) {
    let sql = `SELECT * FROM assessments ORDER BY scheduled_date DESC NULLS LAST`;
    const params: any[] = [];

    // We cannot filter by institute_id since the column doesn't exist.
    // If a specific class or subject is requested, filter by it.
    if (query.classId) {
      params.push(query.classId);
      sql = `SELECT * FROM assessments WHERE class_id=$1 ORDER BY scheduled_date DESC NULLS LAST`;
    } else if (query.subjectId) {
      params.push(query.subjectId);
      sql = `SELECT * FROM assessments WHERE subject_id=$1 ORDER BY scheduled_date DESC NULLS LAST`;
    }

    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const rows: any[] = await this.ds.query(
      `INSERT INTO assessments (title, type, subject_id, class_id, total_marks, duration_minutes, scheduled_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        body.title,
        body.assessmentType || body.type || 'exam',
        body.subjectId || null,
        body.classId || body.class_id || null,
        body.totalMarks || 100,
        body.durationMinutes || 60,
        body.scheduledAt || body.scheduledDate ? new Date(body.scheduledAt || body.scheduledDate) : null,
        body.status || 'draft'
      ],
    );
    const assessment = rows[0];

    // Notify students
    const classId = body.classId || body.class_id;
    try {
      if (classId) {
        const studentUsers = await this.ds.query(
          `SELECT s.user_id FROM students s
           JOIN sections sec ON s.section_id::text = sec.id::text
           WHERE sec.class_id::text = $1`,
          [classId]
        );

        for (const stu of studentUsers) {
          await this.notificationService.create({
            recipientId: stu.user_id,
            type: 'assessment',
            title: 'New Assessment Available',
            message: `${body.title} is now available.`,
            actionUrl: '/school/student/assessments',
          });
        }
      }
    } catch (notifErr) {
      console.error('Failed to send assessment notifications:', notifErr);
    }

    return { success: true, data: assessment };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM assessments WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Assessment not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(`UPDATE assessments SET title=COALESCE($2,title),status=COALESCE($3,status),scheduled_date=COALESCE($4,scheduled_date) WHERE id=$1`, [id, body.title, body.status, body.scheduledAt || body.scheduledDate ? new Date(body.scheduledAt || body.scheduledDate) : null]);
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM assessments WHERE id=$1`, [id]);
    return { success: true };
  }

  async listResults(assessmentId: string) {
    const rows: any[] = await this.ds.query(`SELECT r.*,u.name AS student_name FROM results r LEFT JOIN users u ON r.student_id=u.id WHERE r.assessment_id=$1`, [assessmentId]);
    return { success: true, data: rows };
  }

  async saveResult(body: any) {
    const rows: any[] = await this.ds.query(
      `INSERT INTO results (assessment_id,student_id,marks_obtained,is_absent,grade,remarks) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (assessment_id,student_id) DO UPDATE SET marks_obtained=EXCLUDED.marks_obtained,is_absent=EXCLUDED.is_absent,grade=EXCLUDED.grade,remarks=EXCLUDED.remarks,updated_at=NOW() RETURNING *`,
      [body.assessmentId, body.studentId, body.marksObtained || 0, body.isAbsent || false, body.grade || null, body.remarks || null],
    );
    const result = rows[0];

    // Notify the student
    try {
      const assessmentRows = await this.ds.query(`SELECT title FROM assessments WHERE id = $1`, [body.assessmentId]);
      const assessmentTitle = assessmentRows[0]?.title || 'Assessment';

      await this.notificationService.create({
        recipientId: body.studentId,
        type: 'result',
        title: 'Result Published',
        message: `Your result for ${assessmentTitle} is available. Marks: ${body.marksObtained || 0}`,
        actionUrl: '/school/student/assessments',
      });
    } catch (notifErr) {
      console.error('Failed to send result notification:', notifErr);
    }

    return { success: true, data: result };
  }

  async listSessions(user: any) {
    const instituteId = user.instituteId;
    const rows = await this.ds.query(`
      SELECT 
        ts.id,
        ts.status,
        ts.total_score AS "totalScore",
        ts.accuracy,
        ts.correct_count AS "correctCount",
        ts.wrong_count AS "wrongCount",
        u.name AS "student_name",
        mt.title AS "mock_test_title"
      FROM test_sessions ts
      INNER JOIN students s ON ts.student_id = s.id
      INNER JOIN users u ON s.user_id = u.id
      INNER JOIN mock_tests mt ON ts.mock_test_id = mt.id
      WHERE ts.tenant_id = $1 AND ts.deleted_at IS NULL
      ORDER BY ts.submitted_at DESC NULLS LAST
    `, [instituteId]);

    const mapped = rows.map(r => ({
      id: r.id,
      status: r.status,
      totalScore: r.totalScore,
      accuracy: r.accuracy,
      correctCount: r.correctCount,
      wrongCount: r.wrongCount,
      student: {
        user: {
          name: r.student_name
        }
      },
      mockTest: {
        title: r.mock_test_title
      }
    }));
    return { success: true, data: mapped };
  }
}
