import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolNotificationService } from '../notification/school-notification.service';

type MeetingRow = {
  id: string;
  institute_id: string;
  created_by: string;
  created_by_role: string;
  recipient_user_id: string;
  recipient_role: string | null;
  teacher_user_id: string | null;
  parent_user_id: string | null;
  student_user_id: string | null;
  class_id: string | null;
  section_id: string | null;
  scope_type: string;
  meeting_mode: string;
  title: string;
  description: string | null;
  agenda: string | null;
  meeting_date: string | null;
  start_time: string | null;
  duration_minutes: number | null;
  meeting_link: string | null;
  meeting_platform: string | null;
  location: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class SchoolMeetingService implements OnModuleInit {
  private tableReady = false;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly notificationService: SchoolNotificationService,
  ) {}

  async onModuleInit() {
    await this.ensureTable();
  }

  private async ensureTable() {
    if (this.tableReady) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS school_meetings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID NOT NULL,
        created_by UUID NOT NULL,
        created_by_role VARCHAR(32) NOT NULL,
        recipient_user_id UUID NOT NULL,
        recipient_role VARCHAR(32),
        teacher_user_id UUID,
        parent_user_id UUID,
        student_user_id UUID,
        class_id UUID,
        section_id UUID,
        scope_type VARCHAR(32) NOT NULL DEFAULT 'individual',
        meeting_mode VARCHAR(16) NOT NULL DEFAULT 'online',
        title VARCHAR(255) NOT NULL,
        description TEXT,
        agenda TEXT,
        meeting_date DATE,
        start_time VARCHAR(16),
        duration_minutes INT,
        meeting_link TEXT,
        meeting_platform VARCHAR(64),
        location TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.ds.query(
      `CREATE INDEX IF NOT EXISTS idx_school_meetings_institute ON school_meetings (institute_id)`,
    );
    await this.ds.query(
      `CREATE INDEX IF NOT EXISTS idx_school_meetings_creator ON school_meetings (created_by)`,
    );
    await this.ds.query(
      `CREATE INDEX IF NOT EXISTS idx_school_meetings_recipient ON school_meetings (recipient_user_id)`,
    );
    this.tableReady = true;
  }

  private resolveInstituteId(user: any, override?: string) {
    return user.role === 'SUPER_ADMIN' ? override || user.instituteId : user.instituteId;
  }

  private normalizeMode(mode: unknown) {
    return String(mode || 'online').toLowerCase() === 'offline' ? 'offline' : 'online';
  }

  private normalizeStatus(status: unknown, fallback = 'pending') {
    const value = String(status || fallback).toLowerCase();
    if (['pending', 'accepted', 'rejected', 'cancelled', 'completed', 'scheduled'].includes(value)) {
      return value;
    }
    return fallback;
  }

  private durationToMinutes(value: unknown): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
    const match = String(value).match(/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  private async getUserBasics(userId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT id, name, email, phone, role, institute_id FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    if (!rows.length) throw new NotFoundException('User not found');
    return rows[0];
  }

  private async ensureRecipientInInstitute(instituteId: string, recipientId: string, allowedRoles?: string[]) {
    const params: any[] = [instituteId, recipientId];
    let sql = `SELECT id, name, role FROM users WHERE institute_id = $1 AND id = $2`;
    if (allowedRoles?.length) {
      params.push(allowedRoles);
      sql += ` AND role = ANY($3::text[])`;
    }
    const rows: any[] = await this.ds.query(sql, params);
    if (!rows.length) throw new NotFoundException('Recipient not found');
    return rows[0];
  }

  private async getParentRecipientsForSection(instituteId: string, sectionId: string) {
    return this.ds.query(
      `SELECT DISTINCT p.id, p.name, p.role, u.id AS student_user_id, sec.class_id, s.section_id
       FROM students s
       JOIN users u ON u.id = s.user_id
       JOIN sections sec ON sec.id = s.section_id
       JOIN users p ON p.institute_id = $1 AND p.role = 'PARENT' AND (
         (p.email IS NOT NULL AND s.parent_email IS NOT NULL AND LOWER(p.email) = LOWER(s.parent_email))
         OR
         (p.phone IS NOT NULL AND s.parent_phone IS NOT NULL AND p.phone = s.parent_phone)
       )
       WHERE s.institute_id = $1
         AND s.section_id = $2
       ORDER BY p.name`,
      [instituteId, sectionId],
    );
  }

  private async getParentRecipientsForClass(instituteId: string, classId: string) {
    return this.ds.query(
      `SELECT DISTINCT p.id, p.name, p.role, u.id AS student_user_id, sec.class_id, s.section_id
       FROM students s
       JOIN users u ON u.id = s.user_id
       JOIN sections sec ON sec.id = s.section_id
       JOIN users p ON p.institute_id = $1 AND p.role = 'PARENT' AND (
         (p.email IS NOT NULL AND s.parent_email IS NOT NULL AND LOWER(p.email) = LOWER(s.parent_email))
         OR
         (p.phone IS NOT NULL AND s.parent_phone IS NOT NULL AND p.phone = s.parent_phone)
       )
       WHERE s.institute_id = $1
         AND sec.class_id = $2
       ORDER BY p.name`,
      [instituteId, classId],
    );
  }

  private async getTeacherRecipientsForClass(instituteId: string, classId: string) {
    return this.ds.query(
      `SELECT DISTINCT u.id, u.name, u.role, ta.class_id, ta.section_id
       FROM teacher_academic_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN users u ON u.id = t.user_id
       WHERE u.institute_id = $1
         AND ta.class_id = $2
       ORDER BY u.name`,
      [instituteId, classId],
    );
  }

  private async getTeacherRecipientsForSection(instituteId: string, sectionId: string) {
    return this.ds.query(
      `SELECT DISTINCT u.id, u.name, u.role, ta.class_id, ta.section_id
       FROM teacher_academic_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN users u ON u.id = t.user_id
       WHERE u.institute_id = $1
         AND ta.section_id = $2
       ORDER BY u.name`,
      [instituteId, sectionId],
    );
  }

  private async getTeacherSectionScope(userId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT DISTINCT ta.class_id, ta.section_id
       FROM teachers t
       JOIN teacher_academic_assignments ta ON ta.teacher_id = t.id
       WHERE t.user_id = $1`,
      [userId],
    );
    return {
      classIds: rows.map((r) => String(r.class_id)).filter(Boolean),
      sectionIds: rows.map((r) => String(r.section_id)).filter(Boolean),
    };
  }

  private async getInstituteAdmins(instituteId: string, excludeUserId?: string) {
    const params: any[] = [instituteId];
    let sql = `
      SELECT id, name, role
      FROM users
      WHERE institute_id = $1
        AND role IN ('INSTITUTE_ADMIN', 'SUPER_ADMIN')
    `;
    if (excludeUserId) {
      params.push(excludeUserId);
      sql += ` AND id <> $2`;
    }
    sql += ` ORDER BY name`;
    return this.ds.query(sql, params);
  }

  private mapMeeting(row: any, currentUserId: string) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      agenda: row.agenda,
      meetingMode: row.meeting_mode,
      meetingDate: row.meeting_date,
      startTime: row.start_time,
      durationMinutes: row.duration_minutes,
      meetingLink: row.meeting_link,
      meetingPlatform: row.meeting_platform,
      location: row.location,
      status: row.status,
      scopeType: row.scope_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      timeSlot:
        row.meeting_date && row.start_time ? `${row.meeting_date} • ${row.start_time}` : row.start_time || row.meeting_date || '',
      teacherName: row.teacher_name || null,
      teacherId: row.teacher_user_id || null,
      parentName: row.parent_name || null,
      parentId: row.parent_user_id || null,
      studentName: row.student_name || null,
      studentId: row.student_user_id || null,
      className: row.class_name || null,
      classId: row.class_id || null,
      sectionName: row.section_name || null,
      sectionId: row.section_id || null,
      creatorName: row.creator_name,
      creatorRole: row.created_by_role,
      recipientName: row.recipient_name,
      recipientRole: row.recipient_role,
      counterpartName: String(row.created_by) === String(currentUserId) ? row.recipient_name : row.creator_name,
      counterpartRole: String(row.created_by) === String(currentUserId) ? row.recipient_role : row.created_by_role,
      isIncoming: String(row.recipient_user_id) === String(currentUserId),
      isOutgoing: String(row.created_by) === String(currentUserId),
    };
  }

  private async notifyMeeting(recipientId: string, sender: any, meeting: MeetingRow, recipientRole: string | null, recipientName?: string | null) {
    const actionUrl =
      sender.role === 'PARENT'
        ? '/school/teacher/meetings'
        : sender.role === 'TEACHER' || sender.role === 'INSTITUTE_ADMIN' || sender.role === 'SUPER_ADMIN'
          ? '/school/parent/communication'
          : '/school/parent/communication';

    await this.notificationService.create({
      userId: recipientId,
      recipientId,
      senderId: sender.id,
      senderRole: sender.role,
      recipientRole: recipientRole || null,
      type: 'meeting',
      category: 'meeting',
      priority: 'high',
      title: meeting.title,
      message:
        `${sender.name} scheduled a ${meeting.meeting_mode} meeting` +
        (meeting.meeting_date ? ` on ${meeting.meeting_date}` : '') +
        (meeting.start_time ? ` at ${meeting.start_time}` : '') +
        (recipientName ? ` for ${recipientName}` : ''),
      referenceId: meeting.id,
      referenceType: 'meeting',
      actionUrl,
    });
  }

  async getOptions(user: any, query: any) {
    await this.ensureTable();
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    if (!instituteId) return { success: true, data: { teachers: [], classes: [], sections: [] } };

    const [teachers, classes, sections] = await Promise.all([
      this.ds.query(
        `SELECT u.id, u.name
         FROM users u
         WHERE u.institute_id = $1 AND u.role = 'TEACHER' AND u.is_active = TRUE
         ORDER BY u.name`,
        [instituteId],
      ),
      this.ds.query(
        `SELECT id, name
         FROM classes
         WHERE institute_id = $1
         ORDER BY name`,
        [instituteId],
      ),
      this.ds.query(
        `SELECT sec.id, sec.name, sec.class_id, c.name AS class_name
         FROM sections sec
         LEFT JOIN classes c ON c.id = sec.class_id
         WHERE sec.institute_id = $1
         ORDER BY c.name, sec.name`,
        [instituteId],
      ),
    ]);

    if (user.role === 'TEACHER') {
      const scope = await this.getTeacherSectionScope(user.id);
      return {
        success: true,
        data: {
          teachers: [],
          classes: classes.filter((row: any) => scope.classIds.includes(String(row.id))),
          sections: sections.filter((row: any) => scope.sectionIds.includes(String(row.id))),
        },
      };
    }

    return { success: true, data: { teachers, classes, sections } };
  }

  async list(user: any, query: any) {
    await this.ensureTable();
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    const params: any[] = [instituteId, user.id];
    let sql = `
      SELECT m.*,
             cu.name AS creator_name,
             ru.name AS recipient_name,
             tu.name AS teacher_name,
             pu.name AS parent_name,
             su.name AS student_name,
             c.name AS class_name,
             sec.name AS section_name
      FROM school_meetings m
      LEFT JOIN users cu ON cu.id = m.created_by
      LEFT JOIN users ru ON ru.id = m.recipient_user_id
      LEFT JOIN users tu ON tu.id = m.teacher_user_id
      LEFT JOIN users pu ON pu.id = m.parent_user_id
      LEFT JOIN users su ON su.id = m.student_user_id
      LEFT JOIN classes c ON c.id = m.class_id
      LEFT JOIN sections sec ON sec.id = m.section_id
      WHERE m.institute_id = $1
        AND (m.created_by = $2 OR m.recipient_user_id = $2)`;

    if (query.status && String(query.status).toLowerCase() !== 'all') {
      params.push(String(query.status).toLowerCase());
      sql += ` AND LOWER(m.status) = $${params.length}`;
    }
    if (query.scope === 'incoming') {
      sql += ` AND m.recipient_user_id = $2`;
    }
    if (query.scope === 'outgoing') {
      sql += ` AND m.created_by = $2`;
    }

    sql += ` ORDER BY m.meeting_date DESC NULLS LAST, m.created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
    return rows.map((row) => this.mapMeeting(row, user.id));
  }

  async create(user: any, body: any) {
    await this.ensureTable();
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    if (!instituteId) throw new BadRequestException('Institute ID is required');
    const creator = await this.getUserBasics(user.id);

    const meetingMode = this.normalizeMode(body.meetingMode || body.mode || body.meeting_type);
    if (!body.title?.trim()) throw new BadRequestException('Meeting title is required');
    if (meetingMode === 'online' && !String(body.meetingLink || body.meetingUrl || '').trim() && body.autoGenerateLink !== true) {
      // Allow missing link for now only if the caller explicitly wants to add it later.
    }
    if (meetingMode === 'offline' && !String(body.location || '').trim()) {
      throw new BadRequestException('Location is required for offline meetings');
    }

    const scopeType = String(body.scopeType || 'individual').toLowerCase();
    const recipientMap = new Map<string, any>();

    const addRecipient = (row: any, extra?: any) => {
      if (!row?.id || String(row.id) === String(user.id)) return;
      recipientMap.set(String(row.id), { ...row, ...extra });
    };

    if (Array.isArray(body.recipientIds) && body.recipientIds.length) {
      for (const recipientId of body.recipientIds) {
        const row = await this.ensureRecipientInInstitute(instituteId, String(recipientId));
        addRecipient(row);
      }
    } else if (body.teacherId) {
      addRecipient(await this.ensureRecipientInInstitute(instituteId, String(body.teacherId), ['TEACHER']));
    } else if (body.parentId) {
      addRecipient(await this.ensureRecipientInInstitute(instituteId, String(body.parentId), ['PARENT']));
    } else if (scopeType === 'section_parents') {
      if (!body.sectionId) throw new BadRequestException('Section is required for section parent meetings');
      const parents = await this.getParentRecipientsForSection(instituteId, String(body.sectionId));
      parents.forEach((row: any) =>
        addRecipient({ id: row.id, name: row.name, role: row.role }, {
          student_user_id: row.student_user_id,
          class_id: row.class_id,
          section_id: row.section_id,
        }),
      );
    } else if (scopeType === 'class_parents') {
      if (!body.classId) throw new BadRequestException('Class is required for class parent meetings');
      const parents = await this.getParentRecipientsForClass(instituteId, String(body.classId));
      parents.forEach((row: any) =>
        addRecipient({ id: row.id, name: row.name, role: row.role }, {
          student_user_id: row.student_user_id,
          class_id: row.class_id,
          section_id: row.section_id,
        }),
      );
    } else if (scopeType === 'class_teachers') {
      if (body.sectionId) {
        const teachers = await this.getTeacherRecipientsForSection(instituteId, String(body.sectionId));
        teachers.forEach((row: any) =>
          addRecipient({ id: row.id, name: row.name, role: row.role }, { class_id: row.class_id, section_id: row.section_id }),
        );
      } else if (body.classId) {
        const teachers = await this.getTeacherRecipientsForClass(instituteId, String(body.classId));
        teachers.forEach((row: any) =>
          addRecipient({ id: row.id, name: row.name, role: row.role }, { class_id: row.class_id, section_id: row.section_id }),
        );
      } else {
        throw new BadRequestException('Class or section is required for class teacher meetings');
      }
    }

    const recipients = [...recipientMap.values()];
    if (!recipients.length) {
      throw new BadRequestException('No meeting recipients could be resolved');
    }

    if (user.role === 'PARENT' && recipients.some((r) => r.role !== 'TEACHER')) {
      throw new ForbiddenException('Parents can request meetings only with teachers');
    }

    if (user.role === 'TEACHER' && recipients.some((r) => !['PARENT', 'INSTITUTE_ADMIN', 'SUPER_ADMIN'].includes(String(r.role)))) {
      throw new ForbiddenException('Teachers can schedule meetings only with parents or institute administration');
    }

    if (scopeType !== 'individual' && !['INSTITUTE_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw new ForbiddenException('Bulk meeting creation is available only to institute administration');
    }

    const meetingDate = body.meetingDate || body.date || null;
    const startTime = body.startTime || body.timeSlot || body.time || null;
    const durationMinutes = this.durationToMinutes(body.durationMinutes || body.duration || null);
    const meetingLink = String(body.meetingLink || body.meetingUrl || '').trim() || null;
    const meetingPlatform = String(body.meetingPlatform || '').trim() || null;
    const location = String(body.location || '').trim() || null;
    const description = String(body.description || body.reason || '').trim() || null;
    const agenda = String(body.agenda || '').trim() || null;
    const status = this.normalizeStatus(body.status, user.role === 'PARENT' ? 'pending' : 'scheduled');
    const created: any[] = [];

    for (const recipient of recipients) {
      const teacherUserId =
        user.role === 'TEACHER'
          ? user.id
          : recipient.role === 'TEACHER'
            ? recipient.id
            : body.teacherId || null;
      const parentUserId =
        user.role === 'PARENT'
          ? user.id
          : recipient.role === 'PARENT'
            ? recipient.id
            : body.parentId || null;

      const rows: any[] = await this.ds.query(
        `INSERT INTO school_meetings (
          institute_id, created_by, created_by_role, recipient_user_id, recipient_role,
          teacher_user_id, parent_user_id, student_user_id, class_id, section_id, scope_type,
          meeting_mode, title, description, agenda, meeting_date, start_time, duration_minutes,
          meeting_link, meeting_platform, location, status
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22
        )
        RETURNING *`,
        [
          instituteId,
          user.id,
          user.role,
          recipient.id,
          recipient.role || null,
          teacherUserId,
          parentUserId,
          recipient.student_user_id || body.studentId || null,
          recipient.class_id || body.classId || null,
          recipient.section_id || body.sectionId || null,
          scopeType,
          meetingMode,
          String(body.title).trim(),
          description,
          agenda,
          meetingDate,
          startTime,
          durationMinutes,
          meetingLink,
          meetingPlatform,
          location,
          status,
        ],
      );
      created.push(rows[0]);
      await this.notifyMeeting(recipient.id, creator, rows[0], recipient.role || null, recipient.name || null);

      if (['PARENT', 'TEACHER'].includes(user.role)) {
        const admins = await this.getInstituteAdmins(instituteId, user.id);
        for (const admin of admins) {
          await this.notificationService.create({
            userId: admin.id,
            recipientId: admin.id,
            senderId: user.id,
            senderRole: user.role,
            recipientRole: admin.role,
            type: 'meeting',
            category: 'meeting',
            priority: 'high',
            title: rows[0].title,
            message:
              `${creator.name} raised a meeting request with ${recipient.name}` +
              (meetingDate ? ` on ${meetingDate}` : '') +
              (startTime ? ` at ${startTime}` : ''),
            referenceId: rows[0].id,
            referenceType: 'meeting',
            actionUrl: '/school/admin/communications',
          });
        }
      }
    }

    return {
      success: true,
      count: created.length,
      data: created.length === 1 ? this.mapMeeting({ ...created[0], creator_name: creator.name, recipient_name: recipients[0].name }, user.id) : created,
    };
  }

  async updateStatus(user: any, id: string, body: any) {
    await this.ensureTable();
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const rows: any[] = await this.ds.query(
      `SELECT * FROM school_meetings WHERE id = $1 AND institute_id = $2 LIMIT 1`,
      [id, instituteId],
    );
    if (!rows.length) throw new NotFoundException('Meeting not found');
    const meeting = rows[0];
    const isCreator = String(meeting.created_by) === String(user.id);
    const isRecipient = String(meeting.recipient_user_id) === String(user.id);
    if (!isCreator && !isRecipient && !['INSTITUTE_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw new ForbiddenException('You cannot update this meeting');
    }

    const nextStatus = this.normalizeStatus(body.status, meeting.status);
    if (isRecipient && !['accepted', 'rejected', 'completed'].includes(nextStatus) && !['INSTITUTE_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw new ForbiddenException('Recipients can only accept, reject, or complete a meeting');
    }
    if (isCreator && !['cancelled', 'scheduled', 'completed', 'pending'].includes(nextStatus) && !['INSTITUTE_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw new ForbiddenException('Creators can only reschedule, cancel, or complete a meeting');
    }

    const updateRows: any[] = await this.ds.query(
      `UPDATE school_meetings
       SET status = $2,
           meeting_link = COALESCE($3, meeting_link),
           meeting_platform = COALESCE($4, meeting_platform),
           location = COALESCE($5, location),
           notes = COALESCE($6, notes),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        nextStatus,
        body.meetingLink ?? body.meetingUrl ?? null,
        body.meetingPlatform ?? null,
        body.location ?? null,
        body.notes ?? null,
      ],
    );
    const updated = updateRows[0];

    const notifyUserId = isCreator ? meeting.recipient_user_id : meeting.created_by;
    const actor = await this.getUserBasics(user.id);
    await this.notificationService.create({
      userId: notifyUserId,
      recipientId: notifyUserId,
      senderId: user.id,
      senderRole: user.role,
      type: 'meeting',
      category: 'meeting',
      priority: 'medium',
      title: updated.title || meeting.title || 'Meeting Update',
      message: `${actor.name} marked the meeting as ${nextStatus}.`,
      referenceId: updated.id,
      referenceType: 'meeting',
      actionUrl: user.role === 'PARENT' ? '/school/teacher/meetings' : '/school/parent/communication',
    });

    return { success: true, data: updated };
  }
}
