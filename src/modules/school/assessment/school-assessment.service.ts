import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';

@Injectable()
export class SchoolAssessmentService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
  ) {}

  async list(user: any, query: any) {
    const instituteId = user.role==='SUPER_ADMIN'?(query.instituteId||user.instituteId):user.instituteId;
    const rows: any[] = await this.ds.query(`SELECT * FROM assessments WHERE institute_id=$1 ORDER BY scheduled_at DESC NULLS LAST`, [instituteId]);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const sectionId = body.sectionId || body.section_id;
    const subjectId = body.subjectId || body.subject_id;
    const assessmentType = body.assessmentType || body.assessment_type || 'exam';
    const scheduledAt = body.scheduledAt || body.scheduled_date || body.scheduledDate;
    const durationMinutes = body.durationMinutes || body.duration_minutes;
    const totalMarks = body.totalMarks || body.total_marks;
    const passingMarks = body.passingMarks || body.passing_marks;

    const instituteId = user.role==='SUPER_ADMIN'?(body.instituteId||user.instituteId):user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO assessments (institute_id,subject_id,section_id,created_by,title,assessment_type,total_marks,passing_marks,scheduled_at,duration_minutes,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [instituteId,subjectId||null,sectionId||null,user.id,body.title,assessmentType,totalMarks||100,passingMarks||35,scheduledAt?new Date(scheduledAt):null,durationMinutes||60,body.status||'draft'],
    );
    const assessment = rows[0];

    // Notify students
    try {
      if (sectionId) {
        const studentUsers = await this.ds.query(
          `SELECT user_id FROM students WHERE section_id::text = $1`,
          [sectionId]
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
    await this.ds.query(`UPDATE assessments SET title=COALESCE($2,title),status=COALESCE($3,status),scheduled_at=COALESCE($4,scheduled_at),updated_at=NOW() WHERE id=$1`, [id,body.title,body.status,body.scheduledAt?new Date(body.scheduledAt):null]);
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
      [body.assessmentId,body.studentId,body.marksObtained||0,body.isAbsent||false,body.grade||null,body.remarks||null],
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
