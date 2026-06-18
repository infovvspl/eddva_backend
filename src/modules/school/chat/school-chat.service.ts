import { Injectable, OnModuleInit, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolChatGateway } from './school-chat.gateway';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { SchoolNotificationGateway } from '../notification/school-notification.gateway';

@Injectable()
export class SchoolChatService implements OnModuleInit {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly gateway: SchoolChatGateway,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly notificationGateway: SchoolNotificationGateway,
  ) {}


  async onModuleInit() {
    console.log('--- RUNNING CHAT MIGRATION ---');
    void this.ds.query(`
      ALTER TABLE chat_messages 
      ADD COLUMN IF NOT EXISTS parent_message_id UUID,
      ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_delivered BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS attachment_url VARCHAR,
      ADD COLUMN IF NOT EXISTS attachment_name VARCHAR;
    `)
      .then(() => console.log('--- CHAT MIGRATION SUCCESSFUL ---'))
      .catch((e) => console.error('--- CHAT MIGRATION FAILED ---', e));
  }

  async getConversations(user: any, query: any) {
    const role = query.role || 'TEACHER';
    const rows: any[] = await this.ds.query(
      `SELECT 
        cr.id AS room_id,
        cr.type AS room_type,
        cr.created_at,
        peer.id AS peer_id,
        peer.name AS peer_name,
        peer.email AS peer_email,
        peer.role AS peer_role,
        (SELECT text FROM chat_messages WHERE room_id = cr.id ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT COUNT(*)::int FROM chat_messages WHERE room_id = cr.id AND receiver_id = $1::varchar AND is_read IS NOT TRUE) AS unread_count
      FROM chat_rooms cr
      JOIN chat_participants cp1 ON cp1.room_id = cr.id AND cp1.user_id = $1
      JOIN chat_participants cp2 ON cp2.room_id = cr.id AND cp2.user_id != $1
      JOIN users peer ON peer.id = cp2.user_id
      WHERE cr.type = 'DM' AND LOWER(peer.role) = LOWER($2) AND peer.institute_id = $3
      ORDER BY cr.created_at DESC`,
      [user.id, role, user.instituteId]
    );

    const isTeacher = user.role === 'TEACHER';
    const mapped = rows.map(r => ({
      id: isTeacher ? r.room_id : r.peer_id,
      room_id: r.room_id,
      peer_id: r.peer_id,
      name: r.peer_name,
      email: r.peer_email,
      role: r.peer_role,
      last_message: r.last_message,
      unread_count: r.unread_count,
      created_at: r.created_at
    }));

    // Merge online presence cached values
    const mappedWithPresence = await Promise.all(mapped.map(async (r) => {
      const pRaw = await this.cacheManager.get(`presence:${r.peer_id}`);
      let presence = { status: 'offline', lastSeen: null };
      if (pRaw) {
        try { presence = JSON.parse(pRaw as string); } catch {}
      }
      return {
        ...r,
        online: presence.status === 'online',
        lastSeen: presence.lastSeen,
      };
    }));

    return { success: true, data: mappedWithPresence };
  }

  async getUsers(user: any, query: any) {
    const instituteId = user.instituteId;
    const targetRole = query.role || 'TEACHER';

    let sql = '';
    const params: any[] = [instituteId];

    // Check smart directory restrictions
    if (user.role === 'TEACHER' && targetRole === 'PARENT') {
      // Teachers can only view parents of students in their assigned sections/classes
      sql = `
        SELECT u.id, u.name, u.email, u.role, u.profile_image 
        FROM users u
        WHERE u.institute_id = $1 
          AND u.role = 'PARENT' 
          AND u.is_active = true
          AND (
            (u.email IS NOT NULL AND LOWER(u.email) IN (
              SELECT DISTINCT LOWER(s.parent_email) 
              FROM students s
              LEFT JOIN sections sec ON sec.id = s.section_id
              WHERE s.institute_id = $1 AND s.parent_email IS NOT NULL AND (
                sec.class_teacher_id = (SELECT id FROM teachers WHERE user_id = $2 LIMIT 1)
                OR s.section_id IN (
                  SELECT section_id FROM teacher_academic_assignments 
                  WHERE teacher_id = (SELECT id FROM teachers WHERE user_id = $2 LIMIT 1)
                )
              )
            ))
            OR
            (u.phone IS NOT NULL AND u.phone IN (
              SELECT DISTINCT s.parent_phone 
              FROM students s
              LEFT JOIN sections sec ON sec.id = s.section_id
              WHERE s.institute_id = $1 AND s.parent_phone IS NOT NULL AND (
                sec.class_teacher_id = (SELECT id FROM teachers WHERE user_id = $2 LIMIT 1)
                OR s.section_id IN (
                  SELECT section_id FROM teacher_academic_assignments 
                  WHERE teacher_id = (SELECT id FROM teachers WHERE user_id = $2 LIMIT 1)
                )
              )
            ))
          )
      `;
      params.push(user.id);
    } else if (user.role === 'PARENT' && targetRole === 'TEACHER') {
      // Parents can only view their child's teachers
      sql = `
        SELECT DISTINCT u.id, u.name, u.email, u.role, u.profile_image 
        FROM users u
        JOIN teachers t ON u.id = t.user_id
        WHERE u.institute_id = $1 
          AND u.role = 'TEACHER'
          AND u.is_active = true
          AND t.id IN (
            SELECT taa.teacher_id 
            FROM teacher_academic_assignments taa
            JOIN students s ON s.section_id = taa.section_id
            JOIN users parent ON parent.id = $2
            WHERE s.institute_id = $1 AND (
              (s.parent_email IS NOT NULL AND LOWER(s.parent_email) = LOWER(parent.email))
              OR
              (s.parent_phone IS NOT NULL AND s.parent_phone = parent.phone)
            )
          )
      `;
      params.push(user.id);
    } else {
      // Admin / Super Admin (or default rules for self-communication/staff)
      sql = `SELECT id, name, email, role, profile_image FROM users WHERE institute_id = $1 AND LOWER(role) = LOWER($2) AND is_active = true`;
      params.push(targetRole);
    }

    if (query.q) {
      params.push(`%${query.q}%`);
      sql += ` AND (LOWER(name) LIKE LOWER($${params.length}) OR LOWER(email) LIKE LOWER($${params.length}))`;
    }
    sql += ` ORDER BY name ASC`;

    const rows = await this.ds.query(sql, params);

    // Merge presence status
    const rowsWithPresence = await Promise.all(rows.map(async (r) => {
      const pRaw = await this.cacheManager.get(`presence:${r.id}`);
      let presence = { status: 'offline', lastSeen: null };
      if (pRaw) {
        try { presence = JSON.parse(pRaw as string); } catch {}
      }
      return {
        ...r,
        online: presence.status === 'online',
        lastSeen: presence.lastSeen,
      };
    }));

    return { success: true, data: rowsWithPresence };
  }

  async getMessagesByPeer(userId: string, peerId: string) {
    const rooms = await this.ds.query(
      `SELECT cp1.room_id FROM chat_participants cp1
       JOIN chat_participants cp2 ON cp1.room_id = cp2.room_id
       JOIN chat_rooms cr ON cr.id = cp1.room_id
       WHERE cr.type = 'DM' AND cp1.user_id = $1 AND cp2.user_id = $2`,
      [userId, peerId]
    );
    if (!rooms.length) {
      return { success: true, data: [] };
    }
    return this.getMessages(rooms[0].room_id);
  }

  async markRead(userId: string, peerId: string) {
    const rooms = await this.ds.query(
      `SELECT cp1.room_id FROM chat_participants cp1
       JOIN chat_participants cp2 ON cp1.room_id = cp2.room_id
       JOIN chat_rooms cr ON cr.id = cp1.room_id
       WHERE cr.type = 'DM' AND cp1.user_id = $1 AND cp2.user_id = $2`,
      [userId, peerId]
    );
    if (rooms.length) {
      const roomId = rooms[0].room_id;
      await this.ds.query(
        `UPDATE chat_messages SET is_read = true, is_delivered = true WHERE room_id = $1 AND receiver_id = $2 AND is_read IS NOT TRUE`,
        [roomId, userId]
      );
      try {
        this.gateway.server.to(`user:${peerId}`).emit('conversation_read', { roomId, readerId: userId });
      } catch (err) {
        console.error('Failed to emit conversation_read event:', err);
      }
    }
    return { success: true };
  }

  async listRooms(instituteId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT cr.*,COUNT(cp.user_id)::int AS participant_count FROM chat_rooms cr LEFT JOIN chat_participants cp ON cp.room_id=cr.id WHERE cr.institute_id=$1 GROUP BY cr.id ORDER BY cr.created_at DESC`,
      [instituteId],
    );
    return { success: true, data: rows };
  }

  async createRoom(body: any) {
    const rows: any[] = await this.ds.query(
      `INSERT INTO chat_rooms (type) VALUES ($1) RETURNING *`,
      [body.type || 'GROUP'],
    );
    return { success: true, data: rows[0] };
  }

  async joinRoom(roomId: string, userId: string) {
    await this.ds.query(
      `INSERT INTO chat_participants (room_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [roomId, userId],
    );
    return { success: true, message: 'Joined room successfully' };
  }

  async getMessages(roomId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT cm.*,u.name AS sender_name,u.profile_image AS sender_photo 
       FROM chat_messages cm 
       LEFT JOIN users u ON cm.sender_id=u.id 
       WHERE cm.room_id=$1 
       ORDER BY cm.created_at ASC`,
      [roomId],
    );
    return { success: true, data: rows.map((r) => ({ ...r, content: r.text })) };
  }

  async sendMessage(user: any, body: any) {
    let roomId = body.roomId;
    let receiverId = body.receiverId;
    const text = body.content || body.text;

    const parentMessageId = body.parentMessageId || null;
    const isForwarded = body.isForwarded || false;
    const attachmentUrl = body.attachmentUrl || null;
    const attachmentName = body.attachmentName || null;

    if (!roomId && receiverId) {
      const rooms = await this.ds.query(
        `SELECT cp1.room_id FROM chat_participants cp1
         JOIN chat_participants cp2 ON cp1.room_id = cp2.room_id
         JOIN chat_rooms cr ON cr.id = cp1.room_id
         WHERE cr.type = 'DM' AND cp1.user_id = $1 AND cp2.user_id = $2`,
        [user.id, receiverId]
      );
      if (rooms.length) {
        roomId = rooms[0].room_id;
      } else {
        const newRooms = await this.ds.query(
          `INSERT INTO chat_rooms (type) VALUES ('DM') RETURNING id`,
        );
        roomId = newRooms[0].id;
        await this.ds.query(
          `INSERT INTO chat_participants (room_id,user_id) VALUES ($1,$2),($1,$3)`,
          [roomId, user.id, receiverId]
        );
      }
    }

    if (!receiverId && roomId) {
      const participants = await this.ds.query(
        `SELECT user_id FROM chat_participants WHERE room_id=$1 AND user_id!=$2`,
        [roomId, user.id]
      );
      if (participants.length) {
        receiverId = participants[0].user_id;
      }
    }

    let isDelivered = false;
    if (receiverId) {
      try {
        const pRaw = await this.cacheManager.get(`presence:${receiverId}`);
        if (pRaw) {
          const presence = JSON.parse(pRaw as string);
          isDelivered = presence.status === 'online';
        }
      } catch {}
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO chat_messages (
         room_id, sender_id, receiver_id, text, is_read, is_delivered, tenant_id, 
         parent_message_id, is_forwarded, attachment_url, attachment_name
       ) VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        roomId, 
        user.id, 
        receiverId ? String(receiverId) : null, 
        text, 
        isDelivered,
        user.instituteId ?? null,
        parentMessageId,
        isForwarded,
        attachmentUrl,
        attachmentName
      ],
    );

    const message = { ...rows[0], content: rows[0].text };

    // Emit live event
    this.gateway.emitDirectMessage(message);

    // Integrate notification bells
    if (receiverId) {
      try {
        // Determine recipient role for actionUrl
        const recipientUser = await this.ds.query(`SELECT role FROM users WHERE id = $1`, [receiverId]);
        const recipientRole = recipientUser[0]?.role;
        let actionUrl = '';
        if (recipientRole === 'TEACHER') {
          actionUrl = `/school/teacher/chat?userId=${user.id}`;
        } else if (recipientRole === 'PARENT') {
          actionUrl = `/school/parent/communication?userId=${user.id}`;
        } else if (recipientRole === 'INSTITUTE_ADMIN') {
          actionUrl = `/school/admin/communications?userId=${user.id}`;
        }

        // Determine preview text for attachment/meeting
        let previewText = text || '';
        if (text && text.startsWith('[MEETING_CARD]')) {
          const parts = text.split('|');
          const meetTitle = parts[0].replace('[MEETING_CARD]', '').trim();
          previewText = `📅 Meeting: ${meetTitle}`;
        } else if (attachmentUrl) {
          const file = (attachmentName || attachmentUrl || '').toLowerCase();
          if (file.endsWith('.pdf')) {
            previewText = '📕 PDF Shared';
          } else if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.gif') || file.endsWith('.webp')) {
            previewText = '📷 Image Received';
          } else if (file.endsWith('.mp4') || file.endsWith('.webm') || file.endsWith('.avi') || file.endsWith('.mov')) {
            previewText = '🎥 Video Received';
          } else if (file.endsWith('.mp3') || file.endsWith('.wav') || file.endsWith('.m4a') || file.endsWith('.ogg') || file.endsWith('.aac')) {
            previewText = '🎤 Voice Message';
          } else {
            previewText = '📄 Document Received';
          }
        } else {
          previewText = text.length > 60 ? `${text.slice(0, 60)}...` : text;
        }

        const notifResult = await this.ds.query(
          `INSERT INTO notifications (user_id, recipient_id, sender_id, type, category, title, message, is_read, tenant_id, action_url, created_at, updated_at) 
           VALUES ($1, $1, $2, 'chat', 'chat', $3, $4, false, $5, $6, NOW(), NOW()) RETURNING *`,
          [
            receiverId,
            user.id,
            `New message from ${user.name}`,
            previewText,
            user.instituteId ?? null,
            actionUrl
          ]
        );

        if (notifResult && notifResult.length) {
          const notif = notifResult[0];
          const mapped = {
            id: notif.id,
            userId: notif.user_id,
            recipientId: notif.recipient_id,
            role: notif.role,
            senderId: notif.sender_id,
            referenceId: notif.reference_id,
            referenceType: notif.reference_type,
            actionUrl: notif.action_url,
            type: notif.type,
            category: notif.category || notif.type || 'general',
            priority: notif.priority || 'medium',
            title: notif.title,
            message: notif.message,
            isRead: notif.is_read,
            createdAt: notif.created_at,
            updatedAt: notif.updated_at
          };
          this.notificationGateway.emitNotification(receiverId, mapped);
        }
      } catch (err) {
        console.error('Failed to create in-app notification', (err as Error).message);
      }
    }


    return { success: true, data: message };
  }

  async editMessage(userId: string, messageId: string, content: string) {
    const existing = await this.ds.query(
      `SELECT * FROM chat_messages WHERE id = $1 AND sender_id = $2`,
      [messageId, userId]
    );
    if (!existing.length) {
      throw new ForbiddenException('Message not found or you are not the sender');
    }

    const rows = await this.ds.query(
      `UPDATE chat_messages 
       SET text = $1, is_edited = true, updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [content, messageId]
    );

    const message = { ...rows[0], content: rows[0].text };
    this.gateway.emitMessageUpdate(message);
    return { success: true, data: message };
  }

  async deleteMessage(userId: string, messageId: string) {
    const existing = await this.ds.query(
      `SELECT * FROM chat_messages WHERE id = $1 AND sender_id = $2`,
      [messageId, userId]
    );
    if (!existing.length) {
      throw new ForbiddenException('Message not found or you are not the sender');
    }

    const rows = await this.ds.query(
      `UPDATE chat_messages 
       SET text = 'This message was deleted', is_deleted = true, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [messageId]
    );

    const message = { ...rows[0], content: rows[0].text };
    this.gateway.emitMessageUpdate(message);
    return { success: true, data: message };
  }

  async getParentDirectory(user: any) {
    const studentColumns: Array<{ column_name: string }> = await this.ds.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'students'
         AND column_name IN ('parent_name', 'father_name', 'mother_name')`,
    );
    const studentColumnSet = new Set(studentColumns.map((row) => row.column_name));
    const parentNameExpr = studentColumnSet.has('parent_name') ? `NULLIF(s.parent_name, '')` : `NULL`;
    const fatherNameExpr = studentColumnSet.has('father_name') ? `NULLIF(s.father_name, '')` : `NULL`;
    const motherNameExpr = studentColumnSet.has('mother_name') ? `NULLIF(s.mother_name, '')` : `NULL`;
    const displayParentExpr = `COALESCE(${fatherNameExpr}, ${motherNameExpr}, ${parentNameExpr}, NULLIF(p.name, ''), CONCAT('Parent of ', u.name))`;

    const rows = await this.ds.query(
      `SELECT DISTINCT
        c.name AS class_name,
        sec.name AS section_name,
        ${displayParentExpr} AS parent_name,
        s.parent_phone,
        ${fatherNameExpr} AS father_name,
        ${motherNameExpr} AS mother_name,
        u.name AS student_name,
        p.id AS parent_id,
        ${displayParentExpr} AS parent_name_user,
        p.email AS parent_email
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       JOIN teachers t ON t.user_id = $2
       JOIN teacher_academic_assignments taa
         ON taa.teacher_id = t.id
        AND taa.class_id::text = sec.class_id::text
       JOIN users p ON p.institute_id = $1 AND p.role = 'PARENT' AND (
         (p.email IS NOT NULL AND LOWER(p.email) = LOWER(s.parent_email))
         OR
         (p.phone IS NOT NULL AND p.phone = s.parent_phone)
       )
       WHERE s.institute_id = $1
       ORDER BY c.name, sec.name, u.name`,
      [user.instituteId, user.id]
    );
    console.log('Parent Directory Count:', rows.length);
    console.log('Parent Directory Data:', rows);
    return { success: true, data: rows };
  }
}
