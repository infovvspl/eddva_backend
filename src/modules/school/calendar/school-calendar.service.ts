import { Injectable } from '@nestjs/common';
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
export class SchoolCalendarService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async getEvents(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.schoolId || user.instituteId) : user.instituteId;
    const role = query.role || user.role;
    
    let from, to;
    if (query.month) {
      from = new Date(`${query.month}-01T00:00:00.000Z`);
      to = new Date(from);
      to.setMonth(to.getMonth() + 1);
      to.setDate(to.getDate() - 1);
    } else {
      from = new Date();
      from.setDate(1);
      to = new Date(from);
      to.setMonth(to.getMonth() + 1);
      to.setDate(to.getDate() - 1);
    }

    let sql = `SELECT e.id, e.institute_id AS "instituteId", e.title, e.description, e.category, 
                      e.start_time AS "startTime", e.end_time AS "endTime", 
                      e.is_all_day AS "isAllDay", e.location, e.priority, 
                      e.created_by AS "createdBy", e.created_at AS "createdAt", e.updated_at AS "updatedAt",
                      e.linked_id AS "linkedId", a.status AS "assessmentStatus"
               FROM events e
               LEFT JOIN assessments a ON e.linked_id::text = a.id::text
               WHERE e.institute_id=$1`;
    const params: any[] = [instituteId];

    const startWindow = new Date(from);
    startWindow.setDate(startWindow.getDate() - 14); // Provide a 14-day buffer for calendar overflow days
    const endWindow = new Date(to);
    endWindow.setDate(endWindow.getDate() + 14);

    params.push(startWindow);
    sql += ` AND e.start_time >= $${params.length}`;
    params.push(endWindow);
    sql += ` AND e.start_time <= $${params.length}`;

    if (role === 'TEACHER') {
      sql += ` AND e.category IN ('EXAM', 'HOLIDAY', 'VACATION', 'TEACHER_MEETING', 'LIVE_CLASS', 'EMERGENCY_NOTICE', 'ACADEMIC')`;
    } else if (role === 'STUDENT') {
      sql += ` AND e.category IN ('EXAM', 'HOLIDAY', 'VACATION', 'ASSIGNMENT', 'LIVE_CLASS', 'EMERGENCY_NOTICE', 'ACADEMIC')`;
    } else if (role === 'PARENT') {
      sql += ` AND e.category IN ('EXAM', 'HOLIDAY', 'VACATION', 'PARENT_MEETING', 'EMERGENCY_NOTICE', 'ACADEMIC')`;
    }

    sql += ` ORDER BY e.start_time ASC`;
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
      priority: 'NORMAL',
      linkedId: null,
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
      priority: 'NORMAL',
      linkedId: null,
    }));

    filteredHols = filteredHols.filter(h => new Date(h.startTime) >= startWindow && new Date(h.startTime) <= endWindow);
    filteredVacations = filteredVacations.filter(v => new Date(v.endTime) >= startWindow && new Date(v.startTime) <= endWindow);

    const merged = [...rows, ...filteredHols, ...filteredVacations].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return { success: true, data: merged };
  }
}
