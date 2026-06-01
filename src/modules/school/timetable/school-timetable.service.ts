import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolTimetableService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  // Timetables
  async listTimetables(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `SELECT t.*,c.name AS class_name FROM timetables t LEFT JOIN classes c ON t.class_id::text=c.id::text WHERE t.institute_id::text=$1::text ORDER BY t.created_at DESC`,
      [instituteId],
    );
    return { success: true, data: rows };
  }

  async createTimetable(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `INSERT INTO timetables (institute_id,class_id,name,academic_year,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [instituteId, body.classId || null, body.name, body.academicYear || null, body.isActive !== false],
    );
    return { success: true, data: rows[0] };
  }

  async findOneTimetable(id: string) {
    const rows: any[] = await this.ds.query(`SELECT * FROM timetables WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Timetable not found');
    return { success: true, data: rows[0] };
  }

  async updateTimetable(id: string, body: any) {
    await this.ds.query(
      `UPDATE timetables SET name=COALESCE($2,name),class_id=COALESCE($3,class_id),academic_year=COALESCE($4,academic_year),is_active=COALESCE($5,is_active),updated_at=NOW() WHERE id=$1`,
      [id, body.name, body.classId, body.academicYear, body.isActive],
    );
    return { success: true };
  }

  async removeTimetable(id: string) {
    await this.ds.query(`DELETE FROM timetables WHERE id=$1`, [id]);
    return { success: true };
  }

  // Schedules
  async listSchedules(query: any) {
    let sql = `SELECT s.*,c.name AS class_name,sub.name AS subject_name,u.name AS teacher_name FROM schedules s LEFT JOIN classes c ON s.class_id::text=c.id::text LEFT JOIN subjects sub ON s.subject_id::text=sub.id::text LEFT JOIN users u ON s.teacher_id::text=u.id::text WHERE 1=1`;
    const params: any[] = [];
    if (query.timetableId) { params.push(query.timetableId); sql += ` AND s.timetable_id=$${params.length}`; }
    if (query.classId) { params.push(query.classId); sql += ` AND s.class_id=$${params.length}`; }
    if (query.teacherId) { params.push(query.teacherId); sql += ` AND s.teacher_id=$${params.length}`; }
    sql += ` ORDER BY s.day_of_week,s.start_time`;
    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows };
  }

  async createSchedule(body: any) {
    const rows: any[] = await this.ds.query(
      `INSERT INTO schedules (timetable_id,class_id,subject_id,teacher_id,day_of_week,start_time,end_time,room) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [body.timetableId || null, body.classId || null, body.subjectId || null, body.teacherId || null, body.dayOfWeek, body.startTime, body.endTime, body.room || null],
    );
    return { success: true, data: rows[0] };
  }

  async updateSchedule(id: string, body: any) {
    await this.ds.query(
      `UPDATE schedules SET class_id=COALESCE($2,class_id),subject_id=COALESCE($3,subject_id),teacher_id=COALESCE($4,teacher_id),day_of_week=COALESCE($5,day_of_week),start_time=COALESCE($6,start_time),end_time=COALESCE($7,end_time),room=COALESCE($8,room),updated_at=NOW() WHERE id=$1`,
      [id, body.classId, body.subjectId, body.teacherId, body.dayOfWeek, body.startTime, body.endTime, body.room],
    );
    return { success: true };
  }

  async removeSchedule(id: string) {
    await this.ds.query(`DELETE FROM schedules WHERE id=$1`, [id]);
    return { success: true };
  }
}
