import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolActivityLogService } from '../activity-log/school-activity-log.service';

@Injectable()
export class SchoolSecurityService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly activityLogService: SchoolActivityLogService,
  ) {}

  async getSummary(user: any) {
    let sql = `SELECT COUNT(*) FROM auth_sessions WHERE is_active = true`;
    const params: any[] = [];
    
    // Super Admin sees all sessions. School Admin sees only their school's sessions.
    if (user.role !== 'SUPER_ADMIN') {
      sql += ` AND user_id IN (SELECT id FROM users WHERE institute_id = $1)`;
      params.push(user.instituteId);
    }

    const rows = await this.ds.query(sql, params);
    return {
      activeSessions: parseInt(rows[0].count, 10),
    };
  }

  async getActiveSessions(user: any) {
    let sql = `
      SELECT 
        s.id AS "sessionId",
        s.user_id AS "userId",
        u.name AS "userName",
        u.role AS "role",
        i.name AS "schoolName",
        s.ip_address AS "ipAddress",
        s.browser AS "browser",
        s.created_at AS "loginAt"
      FROM auth_sessions s
      INNER JOIN users u ON u.id = s.user_id
      LEFT JOIN institutes i ON i.id = u.institute_id
      WHERE s.is_active = true
    `;
    const params: any[] = [];

    if (user.role !== 'SUPER_ADMIN') {
      params.push(user.instituteId);
      sql += ` AND u.institute_id = $${params.length}`;
    }

    sql += ` ORDER BY s.created_at DESC LIMIT 100`; // simple pagination/limit

    const rows = await this.ds.query(sql, params);
    return rows;
  }

  async forceLogout(user: any, sessionId: string) {
    // Ensure the session exists and belongs to the correct scope
    let selectSql = `
      SELECT s.id, s.user_id, u.institute_id 
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
    `;
    const params: any[] = [sessionId];
    
    if (user.role !== 'SUPER_ADMIN') {
      params.push(user.instituteId);
      selectSql += ` AND u.institute_id = $${params.length}`;
    }

    const rows = await this.ds.query(selectSql, params);
    if (!rows.length) {
      throw new NotFoundException('Session not found or access denied');
    }

    const session = rows[0];

    // Terminate session
    await this.ds.query(`UPDATE auth_sessions SET is_active = false, updated_at = NOW() WHERE id = $1`, [sessionId]);

    // Log the force logout
    await this.activityLogService.log(
      session.institute_id,
      user.id, // The admin who performed the action
      'FORCE_LOGOUT',
      { targetUserId: session.user_id, sessionId: sessionId }
    );

    return { success: true, message: 'Session terminated successfully' };
  }
}
