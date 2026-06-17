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

    // 1. Verify teacher exists
    const teacherRows = await this.ds.query(`SELECT id FROM teachers WHERE id = $1`, [teacherId]);
    if (!teacherRows.length) {
      throw new BadRequestException('Teacher does not exist.');
    }

    const sectionRows = await this.ds.query(`SELECT class_id FROM sections WHERE id = $1`, [sectionId]);
    if (!sectionRows.length) {
      throw new BadRequestException('Selected section not found');
    }
    const classId = sectionRows[0].class_id;

    // 2. Check if the selected teacher is assigned to this combination in teacher_academic_assignments
    const assignments: any[] = await this.ds.query(
      `SELECT id FROM teacher_academic_assignments 
       WHERE teacher_id = $1 AND class_id = $2 AND section_id = $3 AND subject_id = $4`,
      [teacherId, classId, sectionId, subjectId]
    );

    if (!assignments.length) {
      throw new BadRequestException('This teacher is not assigned to the selected class, section, or subject.');
    }
  }

  private async checkConflicts(body: any, excludeId?: string) {
    const dayOfWeekInt = typeof body.dayOfWeek === 'string' ? (DAY_MAP[body.dayOfWeek.toUpperCase()] || 1) : (body.dayOfWeekInt || 1);
    const periodNumber = body.periodNumber ? parseInt(body.periodNumber, 10) : null;
    const startTime = body.startTime;
    const endTime = body.endTime;
    const room = body.room;

    const query = `
      SELECT 
        t.id, 
        t.teacher_id, 
        t.section_id, 
        t.room, 
        t.period_number, 
        t.start_time, 
        t.end_time,
        sec.name as section_name,
        cls.name as class_name,
        sub.name as subject_name
      FROM timetables t
      LEFT JOIN sections sec ON t.section_id = sec.id
      LEFT JOIN classes cls ON sec.class_id = cls.id
      LEFT JOIN subjects sub ON t.subject_id = sub.id
      WHERE t.day_of_week = $1 AND t.id != $2
    `;
    const params: any[] = [dayOfWeekInt, excludeId || '00000000-0000-0000-0000-000000000000'];

    const existingSlots: any[] = await this.ds.query(query, params);

    for (const slot of existingSlots) {
      // Check time overlap or period overlap
      const slotStart = slot.start_time ? slot.start_time.substring(0, 5) : '00:00';
      const slotEnd = slot.end_time ? slot.end_time.substring(0, 5) : '00:00';
      
      const isTimeOverlap = startTime && endTime && slotStart && slotEnd && (startTime < slotEnd && endTime > slotStart);
      const isPeriodOverlap = periodNumber && slot.period_number && slot.period_number === periodNumber;
      
      if (isTimeOverlap || isPeriodOverlap) {
        const className = slot.class_name || 'Class';
        const sectionName = slot.section_name || '';
        const subjectName = slot.subject_name || 'Subject';
        const timeRange = slotStart && slotEnd ? ` (${slotStart} - ${slotEnd})` : '';

        // Teacher conflict
        if (body.teacherId && slot.teacher_id && String(slot.teacher_id) === String(body.teacherId)) {
          throw new BadRequestException(
            `⚠ Timetable conflict detected: The selected teacher is already scheduled for ${className} - ${sectionName} (${subjectName}) at this time${timeRange}.`
          );
        }
        // Classroom conflict
        if (room && slot.room && slot.room.trim() !== '' && slot.room.trim().toLowerCase() === room.trim().toLowerCase()) {
          throw new BadRequestException(
            `⚠ Timetable conflict detected: Room ${room} is already booked for ${className} - ${sectionName} (${subjectName}) at this time${timeRange}.`
          );
        }
        // Class conflict
        if (body.sectionId && slot.section_id && String(slot.section_id) === String(body.sectionId)) {
          throw new BadRequestException(
            `⚠ Timetable conflict detected: This class already has ${subjectName} scheduled at this time${timeRange}.`
          );
        }
      }
    }
  }

  // Timetables
  async listTimetables(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 100);
    const offset = (page - 1) * limit;

    const countRows = await this.ds.query(
      `SELECT COUNT(*)::int AS total FROM timetables WHERE institute_id::text=$1::text`,
      [instituteId]
    );
    const total = parseInt(countRows[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const rows: any[] = await this.ds.query(
      `SELECT 
        t.id AS "id",
        t.day_of_week AS "dayOfWeekInt",
        t.start_time AS "startTime",
        t.end_time AS "endTime",
        t.room AS "room",
        t.period_number AS "periodNumber",
        t.type AS "type",
        t.meeting_link AS "meetingLink",
        t.remarks AS "remarks",
        t.subject_id AS "subjectId",
        t.teacher_id AS "teacherId",
        t.section_id AS "sectionId",
        t.period_id AS "periodId",
        sp.period_name AS "periodName",
        sp.period_type AS "periodType",
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
      LEFT JOIN school_periods sp ON t.period_id = sp.id OR (t.institute_id = sp.school_id AND t.period_number = sp.sequence_no)
      LEFT JOIN subjects sub ON t.subject_id = sub.id
      LEFT JOIN sections sec ON t.section_id = sec.id
      LEFT JOIN classes cls ON sec.class_id = cls.id
      LEFT JOIN teachers teach ON t.teacher_id = teach.id
      LEFT JOIN users u ON teach.user_id = u.id
      WHERE t.institute_id::text=$1::text
      ORDER BY t.day_of_week, t.start_time
      LIMIT $2 OFFSET $3`,
      [instituteId, limit, offset],
    );

    const formatted = rows.map((row) => ({
      id: row.id,
      dayOfWeek: REV_DAY_MAP[row.dayOfWeekInt] || 'MONDAY',
      startTime: row.startTime ? row.startTime.substring(0, 5) : '09:00',
      endTime: row.endTime ? row.endTime.substring(0, 5) : '10:00',
      room: row.room || '',
      periodNumber: row.periodNumber,
      periodId: row.periodId,
      periodName: row.periodName || `Period ${row.periodNumber}`,
      periodType: row.periodType || 'Academic',
      type: row.type || 'offline',
      meetingLink: row.meetingLink,
      remarks: row.remarks,
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

    return { success: true, data: formatted, total, page, limit, totalPages };
  }

  async getStudentTimetable(user: any) {
    const studentRows = await this.ds.query(`SELECT id, section_id, institute_id FROM students WHERE user_id = $1`, [user.id]);
    if (!studentRows.length) return { success: true, timetable: [] };
    const sectionId = studentRows[0].section_id;
    if (!sectionId) return { success: true, timetable: [] };

    const secRows = await this.ds.query(`SELECT class_id FROM sections WHERE id = $1`, [sectionId]);
    const classId = secRows[0]?.class_id;

    const offlineRows = await this.ds.query(
      `SELECT t.day_of_week, t.start_time, t.end_time, t.room, t.type, t.meeting_link AS "meetingLink",
              t.period_number AS "periodNumber", t.period_id AS "periodId",
              sp.period_name AS "periodName", sp.period_type AS "periodType",
              sub.name as subject, u.name as teacher
       FROM timetables t
       LEFT JOIN school_periods sp ON t.period_id = sp.id OR (t.institute_id = sp.school_id AND t.period_number = sp.sequence_no)
       LEFT JOIN subjects sub ON t.subject_id = sub.id
       LEFT JOIN teachers teach ON t.teacher_id = teach.id
       LEFT JOIN users u ON teach.user_id = u.id
       WHERE t.section_id = $1`, [sectionId]
    );

    const liveRows = await this.ds.query(
      `SELECT s.day_of_week, s.start_time, s.end_time, s.room, sub.name as subject, u.name as teacher
       FROM schedules s
       LEFT JOIN subjects sub ON s.subject_id = sub.id
       LEFT JOIN users u ON s.teacher_id = u.id
       WHERE s.class_id = $1`, [classId]
    );

    const timetable = [
      ...offlineRows.map(r => ({
        subject: r.subject || 'Unknown',
        teacher: r.teacher || 'Unknown',
        day: REV_DAY_MAP[r.day_of_week] || 'MONDAY',
        startTime: r.start_time?.substring(0, 5) || '00:00',
        endTime: r.end_time?.substring(0, 5) || '00:00',
        room: r.room || '',
        type: r.type || 'offline',
        meetingLink: r.meetingLink || null,
        periodNumber: r.periodNumber || null,
        periodId: r.periodId || null,
        periodName: r.periodName || (r.periodNumber ? `Period ${r.periodNumber}` : null),
        periodType: r.periodType || 'Academic',
      })),
      ...liveRows.map(r => ({
        subject: r.subject || 'Unknown',
        teacher: r.teacher || 'Unknown',
        day: typeof r.day_of_week === 'string' ? r.day_of_week.toUpperCase() : (REV_DAY_MAP[r.day_of_week] || 'MONDAY'),
        startTime: r.start_time?.substring(0, 5) || '00:00',
        endTime: r.end_time?.substring(0, 5) || '00:00',
        room: r.room || 'Virtual',
        type: 'live'
      }))
    ];
    
    return { success: true, timetable };
  }

  async createTimetable(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const dayOfWeekInt = DAY_MAP[body.dayOfWeek?.toUpperCase()] || 1;

    // Validate assignment
    // If it's a teacher creating, enforce teacherId
    if (user.role === 'TEACHER') {
      const teachRows = await this.ds.query(`SELECT id FROM teachers WHERE user_id=$1`, [user.id]);
      if (teachRows.length) {
        body.teacherId = teachRows[0].id;
      }
    }
    
    await this.validateAssignment(body.sectionId, body.subjectId, body.teacherId);
    await this.checkConflicts(body);

    const rows: any[] = await this.ds.query(
      `INSERT INTO timetables (institute_id, section_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, period_number, type, meeting_link, remarks, period_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        instituteId,
        body.sectionId || null,
        body.subjectId || null,
        body.teacherId || null,
        dayOfWeekInt,
        body.startTime || '09:00',
        body.endTime || '10:00',
        body.room || null,
        body.periodNumber ? parseInt(body.periodNumber, 10) : null,
        body.type || 'offline',
        body.meetingLink || null,
        body.remarks || null,
        body.periodId || null
      ],
    );
    
    const slotData = (await this.findOneTimetable(rows[0].id)).data;
    try {
      if (body.sectionId) {
        const studentUsers = await this.ds.query(`SELECT user_id FROM students WHERE section_id = $1`, [body.sectionId]);
        const typeBadge = slotData.type === 'live' ? '🔴 Live ' : (slotData.type === 'lab' ? '🧪 Lab ' : (slotData.type === 'extra' ? '✨ Extra ' : ''));
        for (const stu of studentUsers) {
          await this.notificationService.create({
            recipientId: stu.user_id,
            type: 'general',
            title: `📅 New ${typeBadge}Class Scheduled`,
            message: `Subject: ${slotData.subject?.name || 'Class'}\n${slotData.dayOfWeek} • Period ${slotData.periodNumber || 1}\n${slotData.startTime} - ${slotData.endTime}\nRoom: ${slotData.room || 'N/A'}${slotData.meetingLink ? '\nLink provided' : ''}`,
            actionUrl: '/school/student/timetable',
          });
        }
      }
    } catch(e) {
      console.error('Failed to notify students of new timetable', e);
    }
    
    return { success: true, data: slotData };
  }

  async findOneTimetable(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT 
        t.id AS "id",
        t.day_of_week AS "dayOfWeekInt",
        t.start_time AS "startTime",
        t.end_time AS "endTime",
        t.room AS "room",
        t.period_number AS "periodNumber",
        t.type AS "type",
        t.meeting_link AS "meetingLink",
        t.remarks AS "remarks",
        t.subject_id AS "subjectId",
        t.teacher_id AS "teacherId",
        t.section_id AS "sectionId",
        t.period_id AS "periodId",
        sp.period_name AS "periodName",
        sp.period_type AS "periodType",
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
      LEFT JOIN school_periods sp ON t.period_id = sp.id OR (t.institute_id = sp.school_id AND t.period_number = sp.sequence_no)
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
      periodNumber: row.periodNumber,
      periodId: row.periodId,
      periodName: row.periodName || `Period ${row.periodNumber}`,
      periodType: row.periodType || 'Academic',
      type: row.type || 'offline',
      meetingLink: row.meetingLink,
      remarks: row.remarks,
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
    const dayOfWeekInt = body.dayOfWeek ? (DAY_MAP[body.dayOfWeek.toUpperCase()] || 1) : undefined;

    // Validate assignment
    if (body.sectionId || body.subjectId || body.teacherId) {
      const existing = await this.findOneTimetable(id);
      const slot = existing.data;
      const sectionId = body.sectionId || slot.sectionId;
      const subjectId = body.subjectId || slot.subjectId;
      const teacherId = body.teacherId || slot.teacherId;
      await this.validateAssignment(sectionId, subjectId, teacherId);
    }
    
    const conflictCheckBody = {
      ...body,
      dayOfWeekInt,
    };
    await this.checkConflicts(conflictCheckBody, id);

      await this.ds.query(
      `UPDATE timetables SET 
        section_id = COALESCE($2, section_id),
        subject_id = COALESCE($3, subject_id),
        teacher_id = COALESCE($4, teacher_id),
        day_of_week = COALESCE($5, day_of_week),
        start_time = COALESCE($6, start_time),
        end_time = COALESCE($7, end_time),
        room = COALESCE($8, room),
        period_number = COALESCE($9, period_number),
        type = COALESCE($10, type),
        meeting_link = COALESCE($11, meeting_link),
        remarks = COALESCE($12, remarks),
        period_id = COALESCE($13, period_id),
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
        body.room || null,
        body.periodNumber !== undefined ? (body.periodNumber ? parseInt(body.periodNumber, 10) : null) : null,
        body.type || null,
        body.meetingLink || null,
        body.remarks || null,
        body.periodId || null
      ],
    );
    
    const slotData = (await this.findOneTimetable(id)).data;
    try {
      if (slotData.sectionId) {
        const studentUsers = await this.ds.query(`SELECT user_id FROM students WHERE section_id = $1`, [slotData.sectionId]);
        for (const stu of studentUsers) {
          await this.notificationService.create({
            recipientId: stu.user_id,
            type: 'general',
            title: '🔔 Timetable Updated',
            message: `${slotData.subject?.name || 'Class'} class timing has changed.\nNew Schedule:\n${slotData.dayOfWeek} • ${slotData.startTime} - ${slotData.endTime}`,
            actionUrl: '/school/student/timetable',
          });
        }
      }
    } catch(e) {
      console.error('Failed to notify students of timetable update', e);
    }

    return { success: true, data: slotData };
  }

  async removeTimetable(id: string) {
    let slotData = null;
    try {
       slotData = (await this.findOneTimetable(id)).data;
    } catch(e) {}
    
    await this.ds.query(`DELETE FROM timetables WHERE id=$1`, [id]);
    
    try {
      if (slotData && slotData.sectionId) {
        const studentUsers = await this.ds.query(`SELECT user_id FROM students WHERE section_id = $1`, [slotData.sectionId]);
        for (const stu of studentUsers) {
          await this.notificationService.create({
            recipientId: stu.user_id,
            type: 'general',
            title: '❌ Class Cancelled',
            message: `${slotData.subject?.name || 'Class'}\n${slotData.dayOfWeek} • ${slotData.startTime}\nPlease check the updated timetable.`,
            actionUrl: '/school/student/timetable',
          });
        }
      }
    } catch(e) {
      console.error('Failed to notify students of timetable removal', e);
    }
    
    return { success: true };
  }

  // Schedules
  async listSchedules(query: any) {
    let whereClause = `WHERE 1=1`;
    const params: any[] = [];
    if (query.timetableId) { params.push(query.timetableId); whereClause += ` AND s.timetable_id=$${params.length}`; }
    if (query.classId) { params.push(query.classId); whereClause += ` AND s.class_id=$${params.length}`; }
    if (query.teacherId) { params.push(query.teacherId); whereClause += ` AND s.teacher_id=$${params.length}`; }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 100);
    const offset = (page - 1) * limit;

    const countSql = `SELECT COUNT(*)::int AS total FROM schedules s ${whereClause}`;
    const countResult = await this.ds.query(countSql, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const sql = `
      SELECT s.*, c.name AS class_name, sub.name AS subject_name, u.name AS teacher_name 
      FROM schedules s 
      LEFT JOIN classes c ON s.class_id::text=c.id::text 
      LEFT JOIN subjects sub ON s.subject_id::text=sub.id::text 
      LEFT JOIN users u ON s.teacher_id::text=u.id::text 
      ${whereClause} 
      ORDER BY s.day_of_week, s.start_time 
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, data: rows, total, page, limit, totalPages };
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

  async bulkUpdate(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const sectionId = body.sectionId;
    const slots = body.slots || [];

    if (!sectionId) {
      throw new BadRequestException('sectionId is required.');
    }

    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Fetch all periods for this institute to map times & sequence numbers
      const periods = await queryRunner.query(
        `SELECT id, sequence_no, start_time, end_time FROM school_periods WHERE school_id = $1`,
        [instituteId]
      );
      const periodMap = new Map<string, any>(periods.map((p: any) => [p.id, p]));

      // 2. Conflict Checking
      const conflicts: string[] = [];

      for (const slot of slots) {
        if (!slot.subjectId || !slot.teacherId) continue;

        const periodObj = periodMap.get(slot.periodId);
        if (!periodObj) continue;

        const startTime = periodObj.start_time ? String(periodObj.start_time).substring(0, 5) : '00:00';
        const endTime = periodObj.end_time ? String(periodObj.end_time).substring(0, 5) : '00:00';
        const periodNumber = periodObj.sequence_no;

        const dayOfWeekInt = DAY_MAP[slot.dayOfWeek?.toUpperCase()] || 1;
        const slotId = slot.id || '00000000-0000-0000-0000-000000000000';

        // Check conflicts with other sections/classes
        const existingSlots = await queryRunner.query(
          `SELECT 
            t.id, 
            t.teacher_id, 
            t.section_id, 
            t.room, 
            t.period_number, 
            t.start_time, 
            t.end_time,
            sec.name as section_name,
            cls.name as class_name,
            sub.name as subject_name
          FROM timetables t
          LEFT JOIN sections sec ON t.section_id = sec.id
          LEFT JOIN classes cls ON sec.class_id = cls.id
          LEFT JOIN subjects sub ON t.subject_id = sub.id
          WHERE t.day_of_week = $1 AND t.id != $2 AND t.section_id != $3`,
          [dayOfWeekInt, slotId, sectionId]
        );

        for (const dbSlot of existingSlots) {
          const dbStart = dbSlot.start_time ? dbSlot.start_time.substring(0, 5) : '00:00';
          const dbEnd = dbSlot.end_time ? dbSlot.end_time.substring(0, 5) : '00:00';

          const isTimeOverlap = startTime && endTime && dbStart && dbEnd && (startTime < dbEnd && endTime > dbStart);
          const isPeriodOverlap = periodNumber && dbSlot.period_number && dbSlot.period_number === periodNumber;

          if (isTimeOverlap || isPeriodOverlap) {
            if (String(dbSlot.teacher_id) === String(slot.teacherId)) {
              conflicts.push(
                `${slot.dayOfWeek} Period ${periodNumber}: Teacher is already scheduled for ${dbSlot.class_name} - ${dbSlot.section_name} (${dbSlot.subject_name}) at this time.`
              );
            }
            if (slot.room && dbSlot.room && slot.room.trim() !== '' && dbSlot.room.trim().toLowerCase() === slot.room.trim().toLowerCase()) {
              conflicts.push(
                `${slot.dayOfWeek} Period ${periodNumber}: Room ${slot.room} is already booked for ${dbSlot.class_name} - ${dbSlot.section_name} (${dbSlot.subject_name}) at this time.`
              );
            }
          }
        }
      }

      if (conflicts.length > 0) {
        await queryRunner.rollbackTransaction();
        return {
          success: false,
          message: 'Timetable conflict(s) detected.',
          errors: conflicts
        };
      }

      // 3. Delete cleared slots (existing slots not present in active submitted slots)
      const existingSectionSlots = await queryRunner.query(
        `SELECT id FROM timetables WHERE section_id = $1`,
        [sectionId]
      );
      const activeIds = new Set(slots.map((s: any) => String(s.id)).filter(Boolean));
      const idsToDelete = existingSectionSlots
        .map((s: any) => String(s.id))
        .filter((id: string) => !activeIds.has(id));

      if (idsToDelete.length > 0) {
        await queryRunner.query(
          `DELETE FROM timetables WHERE id = ANY($1)`,
          [idsToDelete]
        );
      }

      // 4. Update or Insert remaining slots
      for (const slot of slots) {
        if (!slot.subjectId || !slot.teacherId) continue;

        const periodObj = periodMap.get(slot.periodId);
        const startTime = periodObj ? String(periodObj.start_time).substring(0, 5) : '09:00';
        const endTime = periodObj ? String(periodObj.end_time).substring(0, 5) : '10:00';
        const periodNumber = periodObj ? periodObj.sequence_no : 1;
        const dayOfWeekInt = DAY_MAP[slot.dayOfWeek?.toUpperCase()] || 1;

        if (slot.id) {
          // Update
          await queryRunner.query(
            `UPDATE timetables SET
              subject_id = $2,
              teacher_id = $3,
              day_of_week = $4,
              start_time = $5,
              end_time = $6,
              room = $7,
              period_number = $8,
              type = $9,
              meeting_link = $10,
              remarks = $11,
              period_id = $12,
              updated_at = NOW()
            WHERE id = $1`,
            [
              slot.id,
              slot.subjectId,
              slot.teacherId,
              dayOfWeekInt,
              startTime,
              endTime,
              slot.room || null,
              periodNumber,
              slot.type || 'offline',
              slot.meetingLink || null,
              slot.remarks || null,
              slot.periodId
            ]
          );
        } else {
          // Insert
          await queryRunner.query(
            `INSERT INTO timetables (
              institute_id, section_id, subject_id, teacher_id, day_of_week, 
              start_time, end_time, room, period_number, type, meeting_link, remarks, period_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              instituteId,
              sectionId,
              slot.subjectId,
              slot.teacherId,
              dayOfWeekInt,
              startTime,
              endTime,
              slot.room || null,
              periodNumber,
              slot.type || 'offline',
              slot.meetingLink || null,
              slot.remarks || null,
              slot.periodId
            ]
          );
        }
      }

      await queryRunner.commitTransaction();
      return { success: true, message: 'Bulk update saved successfully.' };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
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
