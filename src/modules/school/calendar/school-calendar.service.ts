import { Injectable, OnModuleInit } from '@nestjs/common';
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

export const DEMO_FEATURED_ACHIEVEMENTS = [
  {
    month: 0,
    monthName: 'January',
    category: 'NATIONAL HONOR',
    achievementTitle: 'Republic Day Parade Leader',
    studentName: 'Kavya Singh',
    studentClass: 'Class XII - A',
    tagline: '"Best NCC Cadet of the State leading the Parade"',
    icon: '🎖️',
    themeColor: 'from-amber-500/20 via-orange-500/10 to-yellow-600/20',
    accentColor: '#f59e0b',
    studentPhoto: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 1,
    monthName: 'February',
    category: 'FINE ARTS',
    achievementTitle: 'Art Competition Winner',
    studentName: 'Siddharth Nair',
    studentClass: 'Class V - A',
    tagline: '"1st Rank in National Youth Poster Exhibition"',
    icon: '🎨',
    themeColor: 'from-purple-500/20 via-pink-500/10 to-indigo-600/20',
    accentColor: '#a855f7',
    studentPhoto: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 2,
    monthName: 'March',
    category: 'ACADEMIC TOPPER',
    achievementTitle: 'Academic Topper',
    studentName: 'Sneha Gupta',
    studentClass: 'Class X - A',
    tagline: '"Scored 99.4% Aggregate in Board Examinations"',
    icon: '📚',
    themeColor: 'from-blue-500/20 via-indigo-500/10 to-sky-600/20',
    accentColor: '#3b82f6',
    studentPhoto: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 3,
    monthName: 'April',
    category: 'ECO CLUB',
    achievementTitle: 'Green Ambassador',
    studentName: 'Vikram Malhotra',
    studentClass: 'Class VIII - B',
    tagline: '"Spearheaded Plantation Drive of 500+ Saplings"',
    icon: '🌲',
    themeColor: 'from-emerald-500/20 via-teal-500/10 to-green-600/20',
    accentColor: '#10b981',
    studentPhoto: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 4,
    monthName: 'May',
    category: 'ROBOTICS & AI',
    achievementTitle: 'Innovation Award',
    studentName: 'Aditya Sen',
    studentClass: 'Class IX - A',
    tagline: '"Robotics & Automation National Youth Winner"',
    icon: '🤖',
    themeColor: 'from-cyan-500/20 via-blue-500/10 to-teal-600/20',
    accentColor: '#06b6d4',
    studentPhoto: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 5,
    monthName: 'June',
    category: 'LEADERSHIP',
    achievementTitle: 'Summer Camp Leader',
    studentName: 'Diya Das',
    studentClass: 'Class VII - C',
    tagline: '"Best All-Rounder in National Leadership Camp"',
    icon: '⛺',
    themeColor: 'from-amber-500/20 via-yellow-500/10 to-orange-600/20',
    accentColor: '#eab308',
    studentPhoto: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 6,
    monthName: 'July',
    category: 'STATE LEVEL',
    achievementTitle: 'Chess Champion',
    studentName: 'Ananya Sharma',
    studentClass: 'Class VIII - A',
    tagline: '"Winner of Odisha State Chess Championship"',
    icon: '♟️',
    themeColor: 'from-indigo-500/20 via-blue-500/10 to-violet-600/20',
    accentColor: '#6366f1',
    studentPhoto: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 7,
    monthName: 'August',
    category: 'ATHLETICS',
    achievementTitle: 'Sports Champion',
    studentName: 'Rohan Verma',
    studentClass: 'Class X - B',
    tagline: '"Gold Medalist in 400m Sprint State Athletics"',
    icon: '⚽',
    themeColor: 'from-rose-500/20 via-red-500/10 to-pink-600/20',
    accentColor: '#f43f5e',
    studentPhoto: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 8,
    monthName: 'September',
    category: 'ORATORY & DEBATE',
    achievementTitle: 'Best Debater',
    studentName: 'Priya Patel',
    studentClass: 'Class IX - C',
    tagline: '"National Inter-School Debate Championship Winner"',
    icon: '🏆',
    themeColor: 'from-amber-500/20 via-orange-500/10 to-yellow-600/20',
    accentColor: '#d97706',
    studentPhoto: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 9,
    monthName: 'October',
    category: 'PERFORMING ARTS',
    achievementTitle: 'Best Dancer',
    studentName: 'Ishita Roy',
    studentClass: 'Class VII - A',
    tagline: '"First Prize in Regional Classical Dance Fest"',
    icon: '🎭',
    themeColor: 'from-pink-500/20 via-rose-500/10 to-fuchsia-600/20',
    accentColor: '#ec4899',
    studentPhoto: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 10,
    monthName: 'November',
    category: 'MUSIC FEST',
    achievementTitle: 'Best Singer',
    studentName: 'Aarav Mehta',
    studentClass: 'Class VI - B',
    tagline: '"Gold Medalist in State Youth Music Festival"',
    icon: '🎵',
    themeColor: 'from-violet-500/20 via-purple-500/10 to-indigo-600/20',
    accentColor: '#8b5cf6',
    studentPhoto: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=400'
  },
  {
    month: 11,
    monthName: 'December',
    category: 'SCIENCE EXHIBITION',
    achievementTitle: 'Science Winner',
    studentName: 'Devansh Kumar',
    studentClass: 'Class XI - A',
    tagline: '"Innovator of AI Smart Irrigation Agriculture Model"',
    icon: '🔬',
    themeColor: 'from-emerald-500/20 via-teal-500/10 to-cyan-600/20',
    accentColor: '#10b981',
    studentPhoto: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=400'
  }
];

@Injectable()
export class SchoolCalendarService implements OnModuleInit {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async onModuleInit() {
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS school_featured_achievements (
          id VARCHAR(64) PRIMARY KEY,
          school_id VARCHAR(64) NOT NULL,
          year INT NOT NULL,
          month INT NOT NULL,
          student_name VARCHAR(255) NOT NULL,
          student_class VARCHAR(255) NOT NULL,
          achievement_title VARCHAR(255) NOT NULL,
          tagline TEXT,
          student_photo TEXT,
          achievement_image TEXT,
          theme_color VARCHAR(100),
          display_order INT DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) {
      // Table creation handled gracefully
    }
  }

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
    startWindow.setDate(startWindow.getDate() - 14);
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

  async getFeaturedAchievements(user: any, query: any) {
    const schoolId = user?.instituteId || user?.schoolId || user?.institute_id || user?.school_id || query?.schoolId || query?.instituteId;
    let customRecords: any[] = [];

    try {
      if (schoolId) {
        customRecords = await this.ds.query(
          `SELECT id, school_id AS "schoolId", year, month, student_name AS "studentName",
                  student_class AS "studentClass", achievement_title AS "achievementTitle",
                  tagline, student_photo AS "studentPhoto", achievement_image AS "achievementImage",
                  theme_color AS "themeColor", is_active AS "isActive"
           FROM school_featured_achievements
           WHERE school_id = $1 AND is_active = TRUE`,
          [schoolId]
        );
      }
    } catch (e) {
      customRecords = [];
    }

    const customByMonth = new Map();
    for (const rec of customRecords) {
      customByMonth.set(Number(rec.month), rec);
    }

    const list = DEMO_FEATURED_ACHIEVEMENTS.map((demo) => {
      const custom = customByMonth.get(demo.month);
      if (custom) {
        return {
          ...demo,
          id: custom.id,
          studentName: custom.studentName || demo.studentName,
          studentClass: custom.studentClass || demo.studentClass,
          achievementTitle: custom.achievementTitle || demo.achievementTitle,
          tagline: custom.tagline || demo.tagline,
          studentPhoto: (custom.studentPhoto && custom.studentPhoto.trim() !== '') ? custom.studentPhoto : demo.studentPhoto,
          themeColor: custom.themeColor || demo.themeColor,
        };
      }
      return demo;
    });

    return { success: true, data: list };
  }

  async saveFeaturedAchievement(user: any, body: any) {
    let schoolId = user?.instituteId || user?.schoolId || user?.institute_id || user?.school_id || body?.schoolId || body?.instituteId;
    if (!schoolId) {
      try {
        const schools = await this.ds.query(`SELECT id FROM institutes LIMIT 1`);
        if (schools.length > 0) schoolId = schools[0].id;
      } catch (e) {}
    }
    if (!schoolId) schoolId = 'default_school';

    const year = Number(body.year || new Date().getFullYear());
    const month = Number(body.month ?? 0);
    const id = body.id || `ach_${schoolId}_${year}_${month}`;

    await this.ds.query(
      `INSERT INTO school_featured_achievements 
        (id, school_id, year, month, student_name, student_class, achievement_title, tagline, student_photo, achievement_image, theme_color, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (id) DO UPDATE SET
        school_id = EXCLUDED.school_id,
        student_name = EXCLUDED.student_name,
        student_class = EXCLUDED.student_class,
        achievement_title = EXCLUDED.achievement_title,
        tagline = EXCLUDED.tagline,
        student_photo = EXCLUDED.student_photo,
        achievement_image = EXCLUDED.achievement_image,
        theme_color = EXCLUDED.theme_color,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()`,
      [
        id,
        schoolId,
        year,
        month,
        body.studentName || '',
        body.studentClass || '',
        body.achievementTitle || '',
        body.tagline || '',
        body.studentPhoto || '',
        body.achievementImage || '',
        body.themeColor || '',
        body.isActive !== false,
      ]
    );

    return { success: true, message: 'Featured achievement updated successfully', id };
  }
}
