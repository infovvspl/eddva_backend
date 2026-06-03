import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const DAY_MAP: Record<string, number> = {
  'MONDAY': 1,
  'TUESDAY': 2,
  'WEDNESDAY': 3,
  'THURSDAY': 4,
  'FRIDAY': 5,
  'SATURDAY': 6,
  'SUNDAY': 7,
};

const REV_DAY_MAP: Record<number, string> = {
  1: 'MONDAY',
  2: 'TUESDAY',
  3: 'WEDNESDAY',
  4: 'THURSDAY',
  5: 'FRIDAY',
  6: 'SATURDAY',
  7: 'SUNDAY',
};

@Injectable()
export class SchoolTimetableService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  // Timetables
  async listTimetables(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    const rows: any[] = await this.ds.query(
      `SELECT 
        t.id AS "id",
        t.day_of_week AS "dayOfWeekInt",
        t.start_time AS "startTime",
        t.end_time AS "endTime",
        t.room AS "room",
        t.subject_id AS "subjectId",
        t.teacher_id AS "teacherId",
        t.section_id AS "sectionId",
        sub.id AS "subject_id",
        sub.name AS "subject_name",
        sec.id AS "section_id",
        sec.name AS "section_name",
        cls.id AS "class_id",
        cls.name AS "class_name",
        teach.id AS "teacher_id",
        u.id AS "user_id",
        u.name AS "user_name"
      FROM timetables t
      LEFT JOIN subjects sub ON t.subject_id = sub.id
      LEFT JOIN sections sec ON t.section_id = sec.id
      LEFT JOIN classes cls ON sec.class_id = cls.id
      LEFT JOIN teachers teach ON t.teacher_id = teach.id
      LEFT JOIN users u ON teach.user_id = u.id
      WHERE t.institute_id::text=$1::text
      ORDER BY t.day_of_week, t.start_time`,
      [instituteId],
    );

    const formatted = rows.map((row) => ({
      id: row.id,
      dayOfWeek: REV_DAY_MAP[row.dayOfWeekInt] || 'MONDAY',
      startTime: row.startTime ? row.startTime.substring(0, 5) : '09:00',
      endTime: row.endTime ? row.endTime.substring(0, 5) : '10:00',
      room: row.room || '',
      sectionId: row.sectionId,
      subjectId: row.subjectId,
      teacherId: row.teacherId,
      subject: row.subject_id ? { id: row.subject_id, name: row.subject_name } : null,
      section: row.section_id ? {
        id: row.section_id,
        name: row.section_name,
        className: row.class_name,
        class: { id: row.class_id, name: row.class_name }
      } : null,
      teacher: row.teacher_id ? {
        id: row.teacher_id,
        user: { id: row.user_id, name: row.user_name }
      } : null,
    }));

    return { success: true, data: formatted };
  }

  async createTimetable(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const dayOfWeekInt = DAY_MAP[body.dayOfWeek] || 1;
    const rows: any[] = await this.ds.query(
      `INSERT INTO timetables (institute_id, section_id, subject_id, teacher_id, day_of_week, start_time, end_time, room) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        instituteId,
        body.sectionId || null,
        body.subjectId || null,
        body.teacherId || null,
        dayOfWeekInt,
        body.startTime || '09:00',
        body.endTime || '10:00',
        body.room || null
      ],
    );
    return this.findOneTimetable(rows[0].id);
  }

  async findOneTimetable(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT 
        t.id AS "id",
        t.day_of_week AS "dayOfWeekInt",
        t.start_time AS "startTime",
        t.end_time AS "endTime",
        t.room AS "room",
        t.subject_id AS "subjectId",
        t.teacher_id AS "teacherId",
        t.section_id AS "sectionId",
        sub.id AS "subject_id",
        sub.name AS "subject_name",
        sec.id AS "section_id",
        sec.name AS "section_name",
        cls.id AS "class_id",
        cls.name AS "class_name",
        teach.id AS "teacher_id",
        u.id AS "user_id",
        u.name AS "user_name"
      FROM timetables t
      LEFT JOIN subjects sub ON t.subject_id = sub.id
      LEFT JOIN sections sec ON t.section_id = sec.id
      LEFT JOIN classes cls ON sec.class_id = cls.id
      LEFT JOIN teachers teach ON t.teacher_id = teach.id
      LEFT JOIN users u ON teach.user_id = u.id
      WHERE t.id::text=$1::text`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Timetable slot not found');
    const row = rows[0];
    const formatted = {
      id: row.id,
      dayOfWeek: REV_DAY_MAP[row.dayOfWeekInt] || 'MONDAY',
      startTime: row.startTime ? row.startTime.substring(0, 5) : '09:00',
      endTime: row.endTime ? row.endTime.substring(0, 5) : '10:00',
      room: row.room || '',
      sectionId: row.sectionId,
      subjectId: row.subjectId,
      teacherId: row.teacherId,
      subject: row.subject_id ? { id: row.subject_id, name: row.subject_name } : null,
      section: row.section_id ? {
        id: row.section_id,
        name: row.section_name,
        className: row.class_name,
        class: { id: row.class_id, name: row.class_name }
      } : null,
      teacher: row.teacher_id ? {
        id: row.teacher_id,
        user: { id: row.user_id, name: row.user_name }
      } : null,
    };
    return { success: true, data: formatted };
  }

  async updateTimetable(id: string, body: any) {
    const dayOfWeekInt = body.dayOfWeek ? (DAY_MAP[body.dayOfWeek] || 1) : undefined;
    await this.ds.query(
      `UPDATE timetables SET 
        section_id = COALESCE($2, section_id),
        subject_id = COALESCE($3, subject_id),
        teacher_id = COALESCE($4, teacher_id),
        day_of_week = COALESCE($5, day_of_week),
        start_time = COALESCE($6, start_time),
        end_time = COALESCE($7, end_time),
        room = COALESCE($8, room),
        updated_at = NOW() 
      WHERE id = $1`,
      [
        id,
        body.sectionId || null,
        body.subjectId || null,
        body.teacherId || null,
        dayOfWeekInt,
        body.startTime || null,
        body.endTime || null,
        body.room || null
      ],
    );
    return this.findOneTimetable(id);
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
