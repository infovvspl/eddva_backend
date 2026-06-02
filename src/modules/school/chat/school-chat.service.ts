import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolChatService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

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
      WHERE cr.type = 'DM' AND LOWER(peer.role) = LOWER($2)
      ORDER BY cr.created_at DESC`,
      [user.id, role]
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

    return { success: true, data: mapped };
  }

  async getUsers(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    const role = query.role || 'TEACHER';
    let sql = `SELECT id, name, email, role FROM users WHERE institute_id=$1 AND LOWER(role)=LOWER($2)`;
    const params: any[] = [instituteId, role];
    if (query.q) {
      params.push(`%${query.q}%`);
      sql += ` AND (LOWER(name) LIKE LOWER($3) OR LOWER(email) LIKE LOWER($3))`;
    }
    sql += ` ORDER BY name ASC`;
    const rows = await this.ds.query(sql, params);
    return { success: true, data: rows };
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
        `UPDATE chat_messages SET is_read = true WHERE room_id = $1 AND receiver_id = $2 AND is_read IS NOT TRUE`,
        [roomId, userId]
      );
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
      `INSERT INTO chat_rooms (institute_id,name,type) VALUES ($1,$2,$3) RETURNING *`,
      [body.instituteId, body.name, body.type || 'GROUP'],
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
      `SELECT cm.*,u.name AS sender_name,u.photo AS sender_photo FROM chat_messages cm LEFT JOIN users u ON cm.sender_id=u.id WHERE cm.room_id=$1 ORDER BY cm.created_at ASC`,
      [roomId],
    );
    return { success: true, data: rows };
  }

  async sendMessage(user: any, body: any) {
    let roomId = body.roomId;
    let receiverId = body.receiverId;
    const text = body.content || body.text;

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
          `INSERT INTO chat_rooms (institute_id,type) VALUES ($1,'DM') RETURNING id`,
          [user.instituteId]
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

    const rows: any[] = await this.ds.query(
      `INSERT INTO chat_messages (room_id,sender_id,receiver_id,text,is_read) VALUES ($1,$2,$3,$4,false) RETURNING *`,
      [roomId, user.id, receiverId ? String(receiverId) : null, text],
    );
    return { success: true, data: rows[0] };
  }
}
