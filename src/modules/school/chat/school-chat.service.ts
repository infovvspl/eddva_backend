import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolChatService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

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
    const rows: any[] = await this.ds.query(
      `INSERT INTO chat_messages (room_id,sender_id,text,message_type) VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.roomId, user.id, body.text, body.messageType || 'text'],
    );
    return { success: true, data: rows[0] };
  }
}
