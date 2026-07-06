import { Injectable, OnModuleInit, Inject, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { SchoolChatGateway } from '../school/chat/school-chat.gateway';
import { NotificationService } from '../notification/notification.service';
import { CoachingChatGateway } from '../coaching-chat/coaching-chat.gateway';

const LEGACY_VIRTUAL_SUPER_ADMIN_ID = 'demo-super-admin';
const VIRTUAL_SUPER_ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const VIRTUAL_SUPER_ADMIN_CONTACT = {
  id: VIRTUAL_SUPER_ADMIN_ID,
  name: 'EDVA Super Admin Support',
  email: 'support@edva.in',
  role: 'SUPER_ADMIN',
  profile_image: null,
  institute_name: 'Platform',
};

@Injectable()
export class CoachingChatService implements OnModuleInit {
  constructor(
    @InjectDataSource('coaching') private readonly ds: DataSource,
    private readonly gateway: SchoolChatGateway,
    private readonly newGateway: CoachingChatGateway,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly notificationService: NotificationService,
  ) { }

  private chatActorIds(user: any): string[] {
    const ids = new Set<string>();
    // For Super Admin we only keep the virtual IDs (canonical support user)
    if (String(user?.role || '').toUpperCase() === 'SUPER_ADMIN') {
      ids.add(VIRTUAL_SUPER_ADMIN_ID);
      ids.add(LEGACY_VIRTUAL_SUPER_ADMIN_ID);
    } else {
      const id = String(user?.id || '').trim();
      if (id) ids.add(id);
    }
    return Array.from(ids);
  }

  private chatUserId(user: any): string {
    const id = String(user?.id || '').trim();
    // Any Super Admin (real UUID or token) is normalized to the virtual support ID
    if (String(user?.role || '').toUpperCase() === 'SUPER_ADMIN') {
      return VIRTUAL_SUPER_ADMIN_ID;
    }
    return id;
  }

  private normalizeChatUserId(userId: any): string {
    const id = String(userId || '').trim();
    return id === LEGACY_VIRTUAL_SUPER_ADMIN_ID ? VIRTUAL_SUPER_ADMIN_ID : id;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async resolveToVirtualIfSuperAdmin(userId: string): Promise<string> {
    const normalized = this.normalizeChatUserId(userId);
    if ([VIRTUAL_SUPER_ADMIN_ID, LEGACY_VIRTUAL_SUPER_ADMIN_ID].includes(normalized)) {
      return normalized;
    }
    if (this.isUuid(normalized)) {
      const users = await this.ds.query(`SELECT role FROM users WHERE id = $1`, [normalized]);
      if (users.length && String(users[0].role).toUpperCase() === 'SUPER_ADMIN') {
        return VIRTUAL_SUPER_ADMIN_ID;
      }
    }
    return normalized;
  }

  async onModuleInit() {
    console.log('--- RUNNING COACHING CHAT MIGRATION ---');
    try {
      await this.ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS "chat_rooms" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "institute_id" character varying,
          "name" character varying,
          "room_type" character varying NOT NULL DEFAULT 'group',
          CONSTRAINT "PK_coaching_chat_rooms" PRIMARY KEY ("id")
        );
      `);

      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS "chat_participants" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "room_id" character varying NOT NULL,
          "user_id" character varying NOT NULL,
          "joined_at" TIMESTAMP WITH TIME ZONE,
          CONSTRAINT "PK_coaching_chat_participants" PRIMARY KEY ("id")
        );
      `);

      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS "chat_messages" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "room_id" character varying NOT NULL,
          "sender_id" character varying NOT NULL,
          "receiver_id" character varying,
          "text" text NOT NULL,
          "message_type" character varying NOT NULL DEFAULT 'text',
          "is_read" boolean NOT NULL DEFAULT false,
          "is_delivered" boolean NOT NULL DEFAULT false,
          "tenant_id" uuid,
          "parent_message_id" uuid,
          "is_forwarded" boolean DEFAULT false,
          "is_edited" boolean DEFAULT false,
          "is_deleted" boolean DEFAULT false,
          "attachment_url" character varying,
          "attachment_name" character varying,
          CONSTRAINT "PK_coaching_chat_messages" PRIMARY KEY ("id")
        );
      `);

      console.log('--- COACHING CHAT MIGRATION SUCCESSFUL ---');
    } catch (e) {
      console.error('--- COACHING CHAT MIGRATION FAILED ---', e);
    }
  }

  async getConversations(user: any, query: any) {
    const role = query.role || 'TEACHER';
    const crossInstitute =
      String(user.role).toUpperCase() === 'SUPER_ADMIN' || role.toUpperCase() === 'SUPER_ADMIN';
    const actorIds = this.chatActorIds(user);

    const rows: any[] = await this.ds.query(
      crossInstitute
        ? `SELECT
            cr.id AS room_id,
            cr.room_type AS room_type,
            cr.created_at,
            cp2.user_id AS peer_id,
            COALESCE(peer.full_name, 'Platform Admin') AS peer_name,
            COALESCE(peer.email, '') AS peer_email,
            COALESCE(peer.role::text, $1) AS peer_role,
            t.name AS peer_institute_name,
            (SELECT text FROM chat_messages WHERE room_id::text = cr.id::text ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*)::int FROM chat_messages WHERE room_id::text = cr.id::text AND receiver_id::text = ANY($2::text[]) AND is_read IS NOT TRUE) AS unread_count
          FROM chat_rooms cr
          JOIN chat_participants cp1 ON cp1.room_id::text = cr.id::text AND cp1.user_id::text = ANY($2::text[])
          JOIN chat_participants cp2 ON cp2.room_id::text = cr.id::text AND cp2.user_id::text != ALL($2::text[])
          LEFT JOIN users peer ON peer.id::text = cp2.user_id::text
          LEFT JOIN tenants t ON t.id = peer.tenant_id
          WHERE cr.room_type = 'DM' AND (LOWER(COALESCE(peer.role::text, $1)) = LOWER($1))
          ORDER BY cr.created_at DESC`
        : `SELECT
            cr.id AS room_id,
            cr.room_type AS room_type,
            cr.created_at,
            peer.id AS peer_id,
            peer.full_name AS peer_name,
            peer.email AS peer_email,
            peer.role AS peer_role,
            NULL AS peer_institute_name,
            (SELECT text FROM chat_messages WHERE room_id::text = cr.id::text ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*)::int FROM chat_messages WHERE room_id::text = cr.id::text AND receiver_id::text = $1::text AND is_read IS NOT TRUE) AS unread_count
          FROM chat_rooms cr
          JOIN chat_participants cp1 ON cp1.room_id::text = cr.id::text AND cp1.user_id::text = $1::text
          JOIN chat_participants cp2 ON cp2.room_id::text = cr.id::text AND cp2.user_id::text != $1::text
          JOIN users peer ON peer.id::text = cp2.user_id::text
          WHERE cr.room_type = 'DM' AND LOWER(peer.role::text) = LOWER($2) AND peer.tenant_id = $3
          ORDER BY cr.created_at DESC`,
      crossInstitute ? [role, actorIds] : [user.id, role, user.tenantId],
    );

    const isTeacher = user.role === 'TEACHER';
    const mapped = rows.map(r => ({
      id: isTeacher ? r.room_id : r.peer_id,
      room_id: r.room_id,
      peer_id: r.peer_id,
      name: r.peer_name,
      email: r.peer_email,
      role: r.peer_role,
      institute_name: r.peer_institute_name ?? null,
      last_message: r.last_message,
      unread_count: r.unread_count,
      created_at: r.created_at
    }));

    // Merge online presence cached values
    const mappedWithPresence = await Promise.all(mapped.map(async (r) => {
      const pRaw = await this.cacheManager.get(`presence:${r.peer_id}`);
      let presence = { status: 'offline', lastSeen: null };
      if (pRaw) {
        try { presence = JSON.parse(pRaw as string); } catch { }
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
    const tenantId = user.tenantId;
    const targetRole = query.role || 'TEACHER';
    const q = query.q || '';

    let sql = '';
    const params: any[] = [];

    if (targetRole.toUpperCase() === 'SUPER_ADMIN') {
      let match = true;
      if (q) {
        const searchStr = q.toLowerCase();
        match = VIRTUAL_SUPER_ADMIN_CONTACT.name.toLowerCase().includes(searchStr) || 
                VIRTUAL_SUPER_ADMIN_CONTACT.email.toLowerCase().includes(searchStr);
      }
      const rows = match ? [{ ...VIRTUAL_SUPER_ADMIN_CONTACT }] : [];
      
      const rowsWithPresence = await Promise.all(rows.map(async (r) => {
        const pRaw = await this.cacheManager.get(`presence:${r.id}`);
        let presence = { status: 'offline', lastSeen: null };
        if (pRaw) {
          try { presence = JSON.parse(pRaw as string); } catch { }
        }
        return {
          ...r,
          online: presence.status === 'online',
          lastSeen: presence.lastSeen,
        };
      }));
      return { success: true, data: rowsWithPresence };
    } else if (String(user.role).toUpperCase() === 'SUPER_ADMIN' && targetRole.toUpperCase() === 'INSTITUTE_ADMIN') {
      sql = `SELECT u.id, u.full_name AS name, u.email, u.role, u.profile_picture_url AS profile_image, t.name AS institute_name
             FROM users u 
             LEFT JOIN tenants t ON t.id = u.tenant_id
             WHERE LOWER(u.role::text) = 'institute_admin' AND u.status = 'active'`;
      if (q) {
        sql += ` AND (u.full_name ILIKE $1 OR u.email ILIKE $1 OR t.name ILIKE $1)`;
        params.push(`%${q}%`);
      }
    } else {
      sql = `SELECT id, full_name AS name, email, role, profile_picture_url AS profile_image 
             FROM users u
             WHERE tenant_id = $1 AND LOWER(role::text) = LOWER($2) AND status = 'active'`;
      params.push(tenantId, targetRole);

      const reqRole = (user.role || '').toUpperCase();
      const tgtRole = targetRole.toUpperCase();

      if (reqRole === 'TEACHER' && tgtRole === 'STUDENT') {
        params.push(user.id);
        sql += ` AND ${this.getSharedBatchConditionSql(`$${params.length}`, 'u.id')}`;
      } else if (reqRole === 'STUDENT' && tgtRole === 'TEACHER') {
        params.push(user.id);
        sql += ` AND ${this.getSharedBatchConditionSql('u.id', `$${params.length}`)}`;
      } else if ((reqRole === 'TEACHER' && tgtRole === 'TEACHER') || (reqRole === 'STUDENT' && tgtRole === 'STUDENT')) {
        sql += ` AND 1=0`;
      }

      if (q) {
        params.push(`%${q}%`);
        sql += ` AND (full_name ILIKE $${params.length} OR email ILIKE $${params.length})`;
      }
    }
    sql += ` ORDER BY name ASC`;

    const rows = await this.ds.query(sql, params);

    const rowsWithPresence = await Promise.all(rows.map(async (r) => {
      const pRaw = await this.cacheManager.get(`presence:${r.id}`);
      let presence = { status: 'offline', lastSeen: null };
      if (pRaw) {
        try { presence = JSON.parse(pRaw as string); } catch { }
      }
      return {
        ...r,
        online: presence.status === 'online',
        lastSeen: presence.lastSeen,
      };
    }));

    return { success: true, data: rowsWithPresence };
  }

  async getMessagesByPeer(user: any, peerId: string) {
    const actorIds = this.chatActorIds(user);
    const rawPeerId = this.normalizeChatUserId(peerId);
    const normalizedPeerId = await this.resolveToVirtualIfSuperAdmin(peerId);
    const canonicalSenderId = this.chatUserId(user); // canonical ID for Super Admin or regular user
    const targetPeerIds = [normalizedPeerId];
    if (rawPeerId !== normalizedPeerId) targetPeerIds.push(rawPeerId);

    // ---- Safety check: ensure both participants exist in the DM room ----
    const existing = await this.ds.query(
      `SELECT cp1.room_id FROM chat_participants cp1
       JOIN chat_participants cp2 ON cp1.room_id = cp2.room_id
       JOIN chat_rooms cr ON cr.id::text = cp1.room_id::text
       WHERE cr.room_type = 'DM'
         AND cp1.user_id::text = ANY($1::text[])
         AND cp2.user_id::text = ANY($2::text[])
       ORDER BY cr.created_at DESC LIMIT 1`,
      [actorIds, targetPeerIds]
    );

    if (existing.length) {
      const roomId = existing[0].room_id;

      // Ensure both canonical participants are present
      const participants = await this.ds.query(
        `SELECT user_id FROM chat_participants WHERE room_id = $1 AND user_id = ANY($2::text[])`,
        [roomId, [canonicalSenderId, normalizedPeerId]],
      );
      const presentIds = participants.map((r: any) => r.user_id);
      if (!presentIds.includes(canonicalSenderId)) {
        await this.ds.query(`INSERT INTO chat_participants (room_id,user_id) VALUES ($1,$2)`, [roomId, canonicalSenderId]);
      }
      if (!presentIds.includes(normalizedPeerId)) {
        await this.ds.query(`INSERT INTO chat_participants (room_id,user_id) VALUES ($1,$2)`, [roomId, normalizedPeerId]);
      }
      return this.getMessages(roomId);
    }

    // No room found – return empty list (unchanged behaviour)
    return { success: true, data: [] };
  }

  async markRead(user: any, peerId: string) {
    const actorIds = this.chatActorIds(user);
    const rawPeerId = this.normalizeChatUserId(peerId);
    const normalizedPeerId = await this.resolveToVirtualIfSuperAdmin(peerId);
    const targetPeerIds = [normalizedPeerId];
    if (rawPeerId !== normalizedPeerId) targetPeerIds.push(rawPeerId);

    const rooms = await this.ds.query(
      `SELECT cp1.room_id FROM chat_participants cp1
       JOIN chat_participants cp2 ON cp1.room_id = cp2.room_id
       JOIN chat_rooms cr ON cr.id::text = cp1.room_id::text
       WHERE cr.room_type = 'DM' AND cp1.user_id::text = ANY($1::text[]) AND cp2.user_id::text = ANY($2::text[])
       ORDER BY cr.created_at DESC LIMIT 1`,
      [actorIds, targetPeerIds]
    );
    if (rooms.length) {
      const roomId = rooms[0].room_id;
      await this.ds.query(
        `UPDATE chat_messages SET is_read = true, is_delivered = true WHERE room_id = $1 AND receiver_id::text = ANY($2::text[]) AND is_read IS NOT TRUE`,
        [roomId, actorIds]
      );
      try {
        this.gateway.server.to(`user:${normalizedPeerId}`).emit('conversation_read', { roomId, readerId: user.id });
      } catch (err) {
        console.error('Failed to emit conversation_read event:', err);
      }
    }
    return { success: true };
  }

  async listRooms(tenantId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT cr.*,COUNT(cp.user_id)::int AS participant_count FROM chat_rooms cr LEFT JOIN chat_participants cp ON cp.room_id::text=cr.id::text WHERE cr.institute_id=$1 GROUP BY cr.id ORDER BY cr.created_at DESC`,
      [tenantId],
    );
    return { success: true, data: rows };
  }

  async createRoom(body: any) {
    const rows: any[] = await this.ds.query(
      `INSERT INTO chat_rooms (room_type) VALUES ($1) RETURNING *`,
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
      `SELECT cm.*,u.full_name AS sender_name,u.profile_picture_url AS sender_photo 
       FROM chat_messages cm 
       LEFT JOIN users u ON cm.sender_id::text = u.id::text 
       WHERE cm.room_id=$1 
       ORDER BY cm.created_at ASC`,
      [roomId],
    );
    return { success: true, data: rows.map((r) => ({ ...r, content: r.text })) };
  }

  private getSharedBatchConditionSql(teacherParam: string, studentUserIdColumn: string): string {
    return `
      EXISTS (
        SELECT 1
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN batches b ON b.id = e.batch_id
        LEFT JOIN batch_subject_teachers bst ON bst.batch_id = b.id AND bst.teacher_id = ${teacherParam}
        WHERE s.user_id = ${studentUserIdColumn}
          AND e.status = 'active'
          AND (b.teacher_id = ${teacherParam} OR bst.teacher_id IS NOT NULL)
      )
    `;
  }

  private async assertCanMessage(
    senderId: string, senderRole: string, senderTenantId: string,
    receiverId: string, receiverRole: string, receiverTenantId: string
  ) {
    const sRole = (senderRole || '').toUpperCase();
    const rRole = (receiverRole || '').toUpperCase();

    if ((sRole === 'SUPER_ADMIN' && rRole === 'INSTITUTE_ADMIN') ||
      (sRole === 'INSTITUTE_ADMIN' && rRole === 'SUPER_ADMIN')) {
      return;
    }

    if (String(senderTenantId) !== String(receiverTenantId)) {
      throw new ForbiddenException('Cross-institute messaging is not allowed');
    }

    if ((sRole === 'INSTITUTE_ADMIN' && (rRole === 'TEACHER' || rRole === 'STUDENT')) ||
      (rRole === 'INSTITUTE_ADMIN' && (sRole === 'TEACHER' || sRole === 'STUDENT'))) {
      return;
    }

    if ((sRole === 'TEACHER' && rRole === 'STUDENT') ||
      (sRole === 'STUDENT' && rRole === 'TEACHER')) {
      const teacherUserId = sRole === 'TEACHER' ? senderId : receiverId;
      const studentUserId = sRole === 'STUDENT' ? senderId : receiverId;

      const condition = this.getSharedBatchConditionSql('$1', '$2');
      const rows = await this.ds.query(`
        SELECT 1 WHERE ${condition}
      `, [teacherUserId, studentUserId]);

      if (rows.length > 0) {
        return;
      }
      throw new ForbiddenException('You can only message students/teachers who share an active batch with you');
    }

    throw new ForbiddenException('Messaging between these roles is not allowed');
  }

  async sendMessage(user: any, body: any) {
    let roomId = body.roomId;
    let receiverId = body.receiverId ? await this.resolveToVirtualIfSuperAdmin(body.receiverId) : null;
    const text = body.content || body.text;
    const senderId = this.chatUserId(user);
    const actorIds = this.chatActorIds(user);

    const parentMessageId = body.parentMessageId || null;
    const isForwarded = body.isForwarded || false;
    const attachmentUrl = body.attachmentUrl || null;
    const attachmentName = body.attachmentName || null;

    if (!receiverId && roomId) {
      const participants = await this.ds.query(
        `SELECT user_id FROM chat_participants WHERE room_id=$1 AND user_id::text!=$2::text`,
        [roomId, senderId]
      );
      if (participants.length) {
        receiverId = await this.resolveToVirtualIfSuperAdmin(participants[0].user_id);
      }
    }

    if (receiverId) {
      let rRole = 'SUPER_ADMIN';
      let rTenantId = null;
      if (![VIRTUAL_SUPER_ADMIN_ID, LEGACY_VIRTUAL_SUPER_ADMIN_ID].includes(String(receiverId))) {
        const receivers = await this.ds.query(`SELECT role, tenant_id FROM users WHERE id = $1`, [receiverId]);
        if (!receivers.length) throw new ForbiddenException('Receiver not found');
        rRole = receivers[0].role;
        rTenantId = receivers[0].tenant_id;
      }
      await this.assertCanMessage(senderId, user.role, user.tenantId, receiverId, rRole, rTenantId);
    }

    if (!roomId && receiverId) {
      const targetReceiverIds = [receiverId];
      if (body.receiverId && receiverId !== body.receiverId) {
         targetReceiverIds.push(this.normalizeChatUserId(body.receiverId));
      }

      const rooms = await this.ds.query(
        `SELECT cp1.room_id FROM chat_participants cp1
         JOIN chat_participants cp2 ON cp1.room_id = cp2.room_id
         JOIN chat_rooms cr ON cr.id::text = cp1.room_id::text
         WHERE cr.room_type = 'DM' AND cp1.user_id::text = ANY($1::text[]) AND cp2.user_id::text = ANY($2::text[])
         ORDER BY cr.created_at DESC LIMIT 1`,
        [actorIds, targetReceiverIds]
      );
      if (rooms.length) {
          roomId = rooms[0].room_id;

          // ---- Safety check: ensure BOTH canonical participants are present ----
          // Fetch any existing participant rows for the identified room.
          const existing = await this.ds.query(
            `SELECT user_id FROM chat_participants WHERE room_id = $1 AND user_id = ANY($2::text[])`,
            [roomId, [senderId, receiverId]]
          );
          const existingIds = existing.map((r: any) => r.user_id);
          // Insert missing sender row
          if (!existingIds.includes(senderId)) {
            await this.ds.query(
              `INSERT INTO chat_participants (room_id,user_id) VALUES ($1,$2)`,
              [roomId, senderId]
            );
          }
          // Insert missing receiver row
          if (!existingIds.includes(receiverId)) {
            await this.ds.query(
              `INSERT INTO chat_participants (room_id,user_id) VALUES ($1,$2)`,
              [roomId, receiverId]
            );
          }
          // --------------------------------------------------------------------
        } else {
        const newRooms = await this.ds.query(
          `INSERT INTO chat_rooms (room_type) VALUES ('DM') RETURNING id`,
        );
        roomId = newRooms[0].id;
        await this.ds.query(
          `INSERT INTO chat_participants (room_id,user_id) VALUES ($1,$2),($1,$3)`,
          [roomId, senderId, receiverId]
        );
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
      } catch { }
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO chat_messages (
         room_id, sender_id, receiver_id, text, is_read, is_delivered, tenant_id, 
         parent_message_id, is_forwarded, attachment_url, attachment_name
       ) VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        roomId,
        senderId,
        receiverId ? String(receiverId) : null,
        text,
        isDelivered,
        user.tenantId ?? null,
        parentMessageId,
        isForwarded,
        attachmentUrl,
        attachmentName
      ],
    );

    const message = { ...rows[0], content: rows[0].text };

    // Emit live event via old gateway (legacy)
    this.gateway.emitDirectMessage(message);

    // Emit live event via new secure gateway
    this.newGateway.emitDirectMessage({
      senderId: message.sender_id,
      receiverId: message.receiver_id,
      tenantId: message.tenant_id,
      ...message
    });

    // Integrate notification bells
    if (receiverId && ![VIRTUAL_SUPER_ADMIN_ID, LEGACY_VIRTUAL_SUPER_ADMIN_ID].includes(String(receiverId))) {
      try {
        let previewText = text || '';
        if (attachmentUrl) {
          previewText = '📄 Document Received';
        } else {
          previewText = text.length > 60 ? `${text.slice(0, 60)}...` : text;
        }

        await this.notificationService.send({
          userId: receiverId,
          tenantId: user.tenantId,
          title: `New message from ${user.name || user.fullName || 'Support'}`,
          body: previewText,
          channels: ['in_app'],
          refType: 'chat',
          refId: senderId,
        });
      } catch (err) {
        console.error('Failed to create in-app notification for coaching chat', (err as Error).message);
      }
    }

    return { success: true, data: message };
  }

  async editMessage(userId: string, messageId: string, content: string) {
    const existing = await this.ds.query(
      `SELECT * FROM chat_messages WHERE id::text = $1::text AND sender_id::text = $2::text`,
      [messageId, userId]
    );
    if (!existing.length) {
      throw new ForbiddenException('Message not found or you are not the sender');
    }

    const rows = await this.ds.query(
      `UPDATE chat_messages 
       SET text = $1, is_edited = true, updated_at = NOW() 
       WHERE id::text = $2::text 
       RETURNING *`,
      [content, messageId]
    );

    const message = { ...rows[0], content: rows[0].text };
    this.gateway.emitMessageUpdate(message);
    return { success: true, data: message };
  }

  async deleteMessage(userId: string, messageId: string) {
    const existing = await this.ds.query(
      `SELECT * FROM chat_messages WHERE id::text = $1::text AND sender_id::text = $2::text`,
      [messageId, userId]
    );
    if (!existing.length) {
      throw new ForbiddenException('Message not found or you are not the sender');
    }

    const rows = await this.ds.query(
      `UPDATE chat_messages 
       SET text = 'This message was deleted', is_deleted = true, updated_at = NOW() 
       WHERE id::text = $1::text 
       RETURNING *`,
      [messageId]
    );

    const message = { ...rows[0], content: rows[0].text };
    this.gateway.emitMessageUpdate(message);
    return { success: true, data: message };
  }
}
