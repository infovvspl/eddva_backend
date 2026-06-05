import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';

@Injectable()
export class SchoolAssignmentService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
  ) {}

  async list(user: any, query: any) {
    const instituteId = user.role==='SUPER_ADMIN'?(query.instituteId||user.instituteId):user.instituteId;
    const rows: any[] = await this.ds.query(`SELECT a.*,sub.name AS subject_name,c.name AS class_name FROM assignments a LEFT JOIN subjects sub ON a.subject_id::text=sub.id::text LEFT JOIN classes c ON a.class_id::text=c.id::text WHERE a.tenant_id=$1 ORDER BY a.due_date DESC`, [instituteId]);
    return { success: true, data: rows };
  }

  async create(user: any, body: any) {
    const classId = body.classId || body.class_id;
    const subjectId = body.subjectId || body.subject_id;
    const dueDate = body.dueDate || body.due_date;
    const instructions = body.description || body.instructions || null;
    const instituteId = user.role==='SUPER_ADMIN'?(body.instituteId||user.instituteId):user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO assignments (tenant_id,class_id,subject_id,title,instructions,due_date,teacher_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [instituteId, classId || null, subjectId || null, body.title, instructions, dueDate ? new Date(dueDate) : null, user.id],
    );
    const assignment = rows[0];

    // Notify students
    try {
      if (classId) {
        const studentUsers = await this.ds.query(
          `SELECT s.user_id FROM students s
           JOIN sections sec ON s.section_id = sec.id
           WHERE sec.class_id::text = $1`,
          [classId]
        );

        for (const stu of studentUsers) {
          await this.notificationService.create({
            recipientId: stu.user_id,
            type: 'assignment',
            title: 'New Assignment',
            message: `${body.title} has been uploaded.`,
            actionUrl: '/school/student/assignments',
          });
        }
      }
    } catch (notifErr) {
      console.error('Failed to send assignment upload notifications:', notifErr);
    }

    return { success: true, data: assignment };
  }

  async submit(user: any, id: string, body: any) {
    const assignmentRows = await this.ds.query(`SELECT * FROM assignments WHERE id = $1`, [id]);
    if (!assignmentRows.length) throw new NotFoundException('Assignment not found');
    const assignment = assignmentRows[0];

    const rows: any[] = await this.ds.query(
      `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, status, submitted_at, notes) 
       VALUES ($1, $2, $3, 'submitted', NOW(), $4) RETURNING *`,
      [assignment.tenant_id, id, user.id, body.notes || null]
    );

    // Notify the teacher
    try {
      if (assignment.teacher_id) {
        await this.notificationService.create({
          recipientId: assignment.teacher_id,
          type: 'submission',
          title: 'Assignment Submitted',
          message: `${user.name} submitted ${assignment.title}.`,
          actionUrl: '/school/teacher/assignments',
        });
      }
    } catch (notifErr) {
      console.error('Failed to send assignment submission notification:', notifErr);
    }

    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM assignments WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Assignment not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(`UPDATE assignments SET title=COALESCE($2,title),instructions=COALESCE($3,instructions),due_date=COALESCE($4,due_date),updated_at=NOW() WHERE id=$1`, [id,body.title,body.description,body.dueDate?new Date(body.dueDate):null]);
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM assignments WHERE id=$1`, [id]);
    return { success: true };
  }
}
