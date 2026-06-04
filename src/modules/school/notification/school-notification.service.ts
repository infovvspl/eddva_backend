import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolNotificationService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    let sql = `SELECT * FROM notifications WHERE user_id=$1`;
    const params: any[] = [user.id];
    if (query.isRead !== undefined) { params.push(query.isRead === 'true'); sql += ` AND is_read=$${params.length}`; }
    if (query.type) { params.push(query.type); sql += ` AND type=$${params.length}`; }
    sql += ` ORDER BY created_at DESC`;
    const rows: any[] = await this.ds.query(sql, params);
    
    const mapped = rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      title: r.title,
      message: r.message,
      isRead: r.is_read,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    return { success: true, data: mapped };
  }

  async create(body: any) {
    const rows: any[] = await this.ds.query(
      `INSERT INTO notifications (user_id,type,title,message,is_read) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.userId, body.type || 'INFO', body.title, body.message, body.isRead || false],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new NotFoundException('Notification not found');
    }
    const rows: any[] = await this.ds.query(`SELECT * FROM notifications WHERE id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Notification not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    await this.ds.query(
      `UPDATE notifications SET title=COALESCE($2,title),message=COALESCE($3,message),type=COALESCE($4,type),is_read=COALESCE($5,is_read),updated_at=NOW() WHERE id=$1`,
      [id, body.title, body.message, body.type, body.isRead],
    );
    return { success: true };
  }

  async unreadCount(user: any) {
    const rows: any[] = await this.ds.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND is_read IS NOT TRUE`,
      [user.id],
    );
    return { success: true, count: rows[0]?.count ?? 0 };
  }

  async markRead(id: string) {
    await this.ds.query(`UPDATE notifications SET is_read=true,updated_at=NOW() WHERE id=$1`, [id]);
    return { success: true };
  }

  async markAllAsRead(user: any) {
    await this.ds.query(`UPDATE notifications SET is_read=true,updated_at=NOW() WHERE user_id=$1 AND is_read=false`, [user.id]);
    return { success: true };
  }

  async getUnreadCount(user: any) {
    const rows = await this.ds.query(`SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND is_read=false`, [user.id]);
    return { success: true, count: rows[0]?.count || 0 };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM notifications WHERE id=$1`, [id]);
    return { success: true };
  }
}
