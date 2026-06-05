import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';

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
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
  ) {}


  private async validateAssignment(sectionId: string, subjectId: string, teacherId: string) {
    if (!sectionId || !subjectId || !teacherId) {
      throw new BadRequestException('sectionId, subjectId, and teacherId are required');
    }

    const sectionRows = await this.ds.query(`SELECT class_id FROM sections WHERE id = $1`, [sectionId]);
    if (!sectionRows.length) {
      throw new BadRequestException('Selected section not found');
    }
    const classId = sectionRows[0].class_id;

    // Check if any teacher is assigned to this combination
    const assignments: any[] = await this.ds.query(
      `SELECT * FROM teacher_academic_assignments 
       WHERE class_id = $1 AND section_id = $2 AND subject_id = $3`,
      [classId, sectionId, subjectId]
    );

    if (!assignments.length) {
      throw new BadRequestException('No teacher is assigned to this subject/class/section combination.');
    }

    // Check if the selected teacher is the assigned one
    const isAssigned = assignments.some(a => String(a.teacher_id) === String(teacherId));
    if (!isAssigned) {
      throw new BadRequestException('The selected teacher is not assigned to this subject/class/section combination.');
    }
  }

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

    // Validate assignment
    await this.validateAssignment(body.sectionId, body.subjectId, body.teacherId);

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

    // Validate assignment
    if (body.sectionId || body.subjectId || body.teacherId) {
      const existing = await this.findOneTimetable(id);
      const slot = existing.data;
      const sectionId = body.sectionId || slot.sectionId;
      const subjectId = body.subjectId || slot.subjectId;
      const teacherId = body.teacherId || slot.teacherId;
      await this.validateAssignment(sectionId, subjectId, teacherId);
    }

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
    const schedule = rows[0];

    // Notify students and teacher
    try {
      if (body.classId && body.subjectId) {
        const classRows = await this.ds.query(`SELECT name FROM classes WHERE id::text = $1`, [body.classId]);
        const className = classRows[0]?.name || 'Class';
        const subjectRows = await this.ds.query(`SELECT name FROM subjects WHERE id::text = $1`, [body.subjectId]);
        const subjectName = subjectRows[0]?.name || 'Subject';

        // Notify students
        const studentUsers = await this.ds.query(
          `SELECT s.user_id FROM students s JOIN sections sec ON s.section_id = sec.id WHERE sec.class_id::text = $1`,
          [body.classId]
        );
        for (const stu of studentUsers) {
          await this.notificationService.create({
            recipientId: stu.user_id,
            type: 'live_class',
            title: 'New Live Class Scheduled',
            message: `${className} ${subjectName} Live Class has been scheduled for ${body.dayOfWeek} at ${body.startTime}.`,
            actionUrl: '/school/student/live-classes',
          });
        }

        // Notify teacher (body.teacherId is users.id)
        if (body.teacherId) {
          await this.notificationService.create({
            recipientId: body.teacherId,
            type: 'live_class',
            title: 'New Class Assigned',
            message: `You have been assigned to teach ${className} ${subjectName} Live Class.`,
            actionUrl: '/school/teacher/classes',
          });
        }
      }
    } catch (notifErr) {
      console.error('Failed to send schedule notifications:', notifErr);
    }

    return { success: true, data: schedule };
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
