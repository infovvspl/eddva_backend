import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolAssessmentService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role==='SUPER_ADMIN'?(query.instituteId||user.instituteId):user.instituteId;
    const rows: any[] = await this.ds.query(`SELECT * FROM assessments WHERE institute_id=$1 ORDER BY scheduled_at DESC NULLS LAST`, [instituteId]);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const instituteId = user.role==='SUPER_ADMIN'?(body.instituteId||user.instituteId):user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO assessments (institute_id,subject_id,section_id,created_by,title,assessment_type,total_marks,passing_marks,scheduled_at,duration_minutes,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [instituteId,body.subjectId||null,body.sectionId||null,user.id,body.title,body.assessmentType||'exam',body.totalMarks||100,body.passingMarks||35,body.scheduledAt?new Date(body.scheduledAt):null,body.durationMinutes||60,body.status||'draft'],
    );
    return { success: true, data: rows[0] };
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
    return { success: true, data: rows[0] };
  }
}
