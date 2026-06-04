import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const HOLIDAYS_2026 = [
  { id: 1, title: 'Makar Sankranti', date: '2026-01-14', type: 'STATE' },
  { id: 2, title: 'Basanta Panchami', date: '2026-01-23', type: 'STATE' },
  { id: 3, title: 'Republic Day', date: '2026-01-26', type: 'NATIONAL' },
  { id: 4, title: 'Maha Shivaratri', date: '2026-02-15', type: 'FESTIVAL' },
  { id: 5, title: 'Dola Purnima', date: '2026-03-03', type: 'STATE' },
  { id: 6, title: 'Holi', date: '2026-03-04', type: 'NATIONAL' },
  { id: 7, title: 'Eid-ul-Fitr', date: '2026-03-21', type: 'FESTIVAL' },
  { id: 8, title: 'Sri Ram Navami', date: '2026-03-27', type: 'STATE' },
  { id: 9, title: 'Utkal Divas', date: '2026-04-01', type: 'STATE' },
  { id: 10, title: 'Good Friday', date: '2026-04-03', type: 'NATIONAL' },
  { id: 11, title: 'Ambedkar Jayanti', date: '2026-04-14', type: 'NATIONAL' },
  { id: 12, title: 'Pana Sankranti', date: '2026-04-14', type: 'STATE' },
  { id: 13, title: 'Raja Sankranti', date: '2026-06-15', type: 'STATE' },
  { id: 14, title: 'Ratha Yatra', date: '2026-07-16', type: 'STATE' },
  { id: 15, title: 'Independence Day', date: '2026-08-15', type: 'NATIONAL' },
  { id: 16, title: 'Ganesh Puja', date: '2026-09-15', type: 'STATE' },
  { id: 17, title: 'Gandhi Jayanti', date: '2026-10-02', type: 'NATIONAL' },
  { id: 18, title: 'Maha Saptami', date: '2026-10-18', type: 'STATE' },
  { id: 19, title: 'Maha Asthami', date: '2026-10-19', type: 'STATE' },
  { id: 20, title: 'Maha Navami', date: '2026-10-20', type: 'STATE' },
  { id: 21, title: 'Vijayadashami', date: '2026-10-21', type: 'NATIONAL' },
  { id: 22, title: 'Deepavali', date: '2026-11-08', type: 'NATIONAL' },
  { id: 23, title: 'Christmas', date: '2026-12-25', type: 'NATIONAL' }
];

const VACATIONS_2026 = [
  { id: 1, title: 'Summer Vacation', startDate: '2026-05-05', endDate: '2026-06-05', type: 'VACATION' },
  { id: 2, title: 'Durga Puja Vacation', startDate: '2026-10-17', endDate: '2026-10-24', type: 'VACATION' },
  { id: 3, title: 'Winter Vacation', startDate: '2026-12-24', endDate: '2026-12-31', type: 'VACATION' }
];

@Injectable()
export class SchoolEventService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async list(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let sql = `SELECT id, institute_id AS "instituteId", title, description, category, 
                      start_time AS "startTime", end_time AS "endTime", 
                      is_all_day AS "isAllDay", location, priority, 
                      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
               FROM events WHERE institute_id=$1`;
    const params: any[] = [instituteId];
    
    if (query.from) {
      params.push(new Date(query.from));
      sql += ` AND start_time >= $${params.length}`;
    }
    if (query.to) {
      params.push(new Date(query.to));
      sql += ` AND start_time <= $${params.length}`;
    }
    if (query.category && query.category !== 'All') {
      params.push(query.category);
      sql += ` AND category=$${params.length}`;
    } else if (query.type && query.type !== 'All') {
      params.push(query.type);
      sql += ` AND category=$${params.length}`;
    }
    
    sql += ` ORDER BY start_time ASC`;
    const rows: any[] = await this.ds.query(sql, params);

    let filteredHols = HOLIDAYS_2026.map(h => ({
      id: `static_hol_${h.id}`,
      instituteId,
      title: h.title,
      description: `${h.type} Holiday`,
      category: 'HOLIDAY',
      startTime: `${h.date}T00:00:00.000Z`,
      endTime: `${h.date}T23:59:59.000Z`,
      isAllDay: true,
      location: null,
      priority: 'NORMAL',
      createdBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    let filteredVacations = VACATIONS_2026.map(v => ({
      id: `static_vac_${v.id}`,
      instituteId,
      title: v.title,
      description: 'Vacation',
      category: 'VACATION',
      startTime: `${v.startDate}T00:00:00.000Z`,
      endTime: `${v.endDate}T23:59:59.000Z`,
      isAllDay: true,
      location: null,
      priority: 'NORMAL',
      createdBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    // Filter by dates
    if (query.from) {
      const fromD = new Date(query.from);
      filteredHols = filteredHols.filter(h => new Date(h.startTime) >= fromD);
      filteredVacations = filteredVacations.filter(v => new Date(v.endTime) >= fromD);
    }
    if (query.to) {
      const toD = new Date(query.to);
      filteredHols = filteredHols.filter(h => new Date(h.startTime) <= toD);
      filteredVacations = filteredVacations.filter(v => new Date(v.startTime) <= toD);
    }

    // Filter by category
    const catFilter = query.category || query.type;
    if (catFilter && catFilter !== 'All') {
      filteredHols = filteredHols.filter(h => h.category === catFilter);
      filteredVacations = filteredVacations.filter(v => v.category === catFilter);
    }

    const merged = [
      ...rows,
      ...filteredHols,
      ...filteredVacations,
    ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    return merged;
  }

  async create(user: any, body: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (body.instituteId || user.instituteId) : user.instituteId;
    const startTime = body.startTime ? new Date(body.startTime) : new Date();
    const endTime = body.endTime ? new Date(body.endTime) : null;
    const isAllDay = body.isAllDay ?? false;
    const createdBy = user.id || null;
    
    const rows: any[] = await this.ds.query(
      `INSERT INTO events (institute_id, title, description, category, start_time, end_time, is_all_day, location, priority, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id, institute_id AS "instituteId", title, description, category, 
                 start_time AS "startTime", end_time AS "endTime", 
                 is_all_day AS "isAllDay", location, priority, 
                 created_by AS "createdBy"`,
      [instituteId, body.title, body.description || null, body.category || 'ACADEMIC', startTime, endTime, isAllDay, body.location || null, body.priority || 'NORMAL', createdBy],
    );
    return { success: true, data: rows[0] };
  }

  async findOne(id: string) {
    const rows: any[] = await this.ds.query(
      `SELECT id, institute_id AS "instituteId", title, description, category, 
              start_time AS "startTime", end_time AS "endTime", 
              is_all_day AS "isAllDay", location, priority, 
              created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM events WHERE id=$1`,
      [id]
    );
    if (!rows.length) throw new NotFoundException('Event not found');
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    const startTime = body.startTime ? new Date(body.startTime) : null;
    const endTime = body.endTime ? new Date(body.endTime) : null;
    
    await this.ds.query(
      `UPDATE events 
       SET title=COALESCE($2, title),
           description=COALESCE($3, description),
           category=COALESCE($4, category),
           start_time=COALESCE($5, start_time),
           end_time=COALESCE($6, end_time),
           is_all_day=COALESCE($7, is_all_day),
           location=COALESCE($8, location),
           priority=COALESCE($9, priority),
           updated_at=NOW() 
       WHERE id=$1`,
      [id, body.title, body.description, body.category, startTime, endTime, body.isAllDay, body.location, body.priority],
    );
    return { success: true };
  }

  async remove(id: string) {
    await this.ds.query(`DELETE FROM events WHERE id=$1`, [id]);
    return { success: true };
  }
}
