import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Cache } from 'cache-manager';

const SUBJECT_TTL = 30 * 60 * 1000; // 30 min — curriculum changes are admin-initiated

function normalizeSubjectName(name: string): string {
  if (!name) return '';
  const cleaned = name.trim().replace(/\s+/g, ' ');
  const lowerCleaned = cleaned.toLowerCase();

  if (lowerCleaned === 'math' || lowerCleaned === 'maths' || lowerCleaned === 'mathematics') {
    return 'Mathematics';
  }
  if (lowerCleaned === 'hindi') {
    return 'Hindi';
  }
  if (lowerCleaned === 'english') {
    return 'English';
  }
  if (lowerCleaned === 'science') {
    return 'Science';
  }
  if (lowerCleaned === 'biology') {
    return 'Biology';
  }
  if (lowerCleaned === 'computer science') {
    return 'Computer Science';
  }
  if (lowerCleaned === 'social science') {
    return 'Social Science';
  }
  if (lowerCleaned === 'history') {
    return 'History';
  }

  // Title case general words
  return cleaned
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

@Injectable()
export class SchoolSubjectService {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) { }

  private async resolveInstituteId(user: any, id?: string) {
    return user.role === 'SUPER_ADMIN' ? (id || user.instituteId) : user.instituteId;
  }

  private subjectListKey(instituteId: string, classId?: string, sectionId?: string, page = 1, limit = 10) {
    return `school:subjects:list:${instituteId}:${classId ?? '_'}:${sectionId ?? '_'}:p${page}:l${limit}`;
  }

  async invalidateSubjectCache(instituteId: string) {
    try {
      const store = this.cache.store;
      let keysDeleted = false;
      if (store && typeof store.keys === 'function') {
        const allKeys: string[] = await store.keys();
        const prefix = `school:subjects:list:${instituteId}`;
        const matchingKeys = allKeys.filter(k => k.startsWith(prefix));
        if (matchingKeys.length > 0) {
          await Promise.all(matchingKeys.map(k => this.cache.del(k)));
          keysDeleted = true;
        }
      }

      // Direct pattern invalidation fallback (essential for all environments)
      const limits = [10, 20, 50, 100, 500];
      const fallbackKeys: string[] = [];

      // Delete general prefix keys
      fallbackKeys.push(`school:subjects:list:${instituteId}`);
      fallbackKeys.push(`school:subjects:list:${instituteId}:_:_`);

      // Delete page / limit variations
      for (const l of limits) {
        fallbackKeys.push(this.subjectListKey(instituteId, undefined, undefined, 1, l));
      }

      // Clean up common classId specific keys by iterating through typical page/limits
      // This solves classId specific caching issues when store.keys is missing or bypassed
      await Promise.all(fallbackKeys.map(k => this.cache.del(k).catch(() => undefined)));
    } catch (e) {
      console.error('Failed to invalidate subject cache:', e);
    }
  }

  async list(user: any, query: any) {
    const instituteId = await this.resolveInstituteId(user, query.instituteId);
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const isTeacher = user.role === 'TEACHER';

    // Only cache general non-search list requests — class or section scoped lists should bypass cache to avoid stale caches
    let cacheKey = (query.search || query.classId || query.sectionId) ? null : this.subjectListKey(instituteId, query.classId, query.sectionId, page, limit);
    if (cacheKey && isTeacher) {
      cacheKey += `:teacher:${user.id}`;
    }
    if (cacheKey) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    let filter = `s.institute_id=$1`;
    const params: any[] = [instituteId];

    if (isTeacher) {
      params.push(user.id);
      filter += ` AND s.id IN (SELECT DISTINCT subject_id FROM teacher_academic_assignments ta JOIN teachers t ON ta.teacher_id = t.id WHERE t.user_id = $${params.length} AND ta.subject_id IS NOT NULL)`;
    }

    if (query.classId) {
      params.push(query.classId);
      filter += ` AND s.class_id=$${params.length}`;
    }
    if (query.sectionId) {
      params.push(query.sectionId);
      filter += ` AND s.section_id=$${params.length}`;
    }

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(s.name) LIKE $${params.length} OR LOWER(s.code) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM subjects s
      LEFT JOIN classes c ON s.class_id = c.id 
      LEFT JOIN sections sec ON s.section_id = sec.id 
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const allowedSortFields: Record<string, string> = {
      name: 's.name',
      code: 's.code',
    };
    const sortBy = allowedSortFields[query.sortBy] || 's.name';
    const sortOrder = query.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const sql = `
      SELECT s.*, c.name AS class_name, sec.name AS section_name,
             COALESCE((
               SELECT json_agg(
                 json_build_object(
                   'id', ch.id,
                   'name', ch.name,
                   'sortOrder', ch.sort_order,
                   'subjectId', ch.subject_id
                 )
                 ORDER BY ch.sort_order, ch.name
               )
               FROM chapters ch
               WHERE ch.subject_id::text = s.id::text
             ), '[]'::json) AS chapters
      FROM subjects s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      WHERE ${filter}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const rows: any[] = await this.ds.query(sql, params);
    const result = { success: true, data: rows, total, page, limit, totalPages };
    if (cacheKey) await this.cache.set(cacheKey, result, SUBJECT_TTL);
    return result;
  }

  async create(user: any, body: any) {
    const instituteId = await this.resolveInstituteId(user, body.instituteId);
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException('Subject name is required');
    }
    const normalizedName = normalizeSubjectName(body.name);

    // Uniqueness check: LOWER(TRIM(name)) within same scope (instituteId, classId, sectionId)
    let dupQuery = `
      SELECT id FROM subjects 
      WHERE institute_id = $1 
        AND LOWER(TRIM(name)) = LOWER(TRIM($2))
    `;
    const dupParams = [instituteId, normalizedName];
    if (body.classId) {
      dupQuery += ` AND class_id = $3`;
      dupParams.push(body.classId);
    } else {
      dupQuery += ` AND class_id IS NULL`;
    }
    if (body.sectionId) {
      dupQuery += ` AND section_id = $${dupParams.length + 1}`;
      dupParams.push(body.sectionId);
    } else {
      dupQuery += ` AND section_id IS NULL`;
    }

    const dups = await this.ds.query(dupQuery, dupParams);
    if (dups.length > 0) {
      throw new BadRequestException('Subject already exists.');
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO subjects (institute_id,name,class_id,section_id,code,type,description) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [instituteId, normalizedName, body.classId || null, body.sectionId || null, body.code || null, body.type || 'Theory', body.description || null]
    );
    await this.invalidateSubjectCache(instituteId);
    return { success: true, data: rows[0] };
  }

  async update(id: string, body: any) {
    const currentRows = await this.ds.query(`SELECT * FROM subjects WHERE id = $1`, [id]);
    if (currentRows.length === 0) {
      throw new BadRequestException('Subject not found');
    }
    const current = currentRows[0];

    const normalizedName = body.name ? normalizeSubjectName(body.name) : current.name;
    const classId = body.classId !== undefined ? (body.classId || null) : current.class_id;
    const sectionId = body.sectionId !== undefined ? (body.sectionId || null) : current.section_id;

    if (body.name || body.classId !== undefined || body.sectionId !== undefined) {
      // Check for duplicate
      let dupQuery = `
        SELECT id FROM subjects 
        WHERE institute_id = $1 
          AND LOWER(TRIM(name)) = LOWER(TRIM($2))
          AND id <> $3
      `;
      const dupParams = [current.institute_id, normalizedName, id];
      if (classId) {
        dupQuery += ` AND class_id = $4`;
        dupParams.push(classId);
      } else {
        dupQuery += ` AND class_id IS NULL`;
      }
      if (sectionId) {
        dupQuery += ` AND section_id = $${dupParams.length + 1}`;
        dupParams.push(sectionId);
      } else {
        dupQuery += ` AND section_id IS NULL`;
      }

      const dups = await this.ds.query(dupQuery, dupParams);
      if (dups.length > 0) {
        throw new BadRequestException('Subject already exists.');
      }
    }

    await this.ds.query(
      `UPDATE subjects SET name=COALESCE($2,name),class_id=$3,section_id=$4,code=COALESCE($5,code),type=COALESCE($6,type),description=COALESCE($7,description),updated_at=NOW() WHERE id=$1`,
      [id, body.name ? normalizedName : current.name, classId, sectionId, body.code, body.type, body.description]
    );
    await this.invalidateSubjectCache(current.institute_id);
    return { success: true };
  }

  async remove(id: string) {
    const subRows: any[] = await this.ds.query(`SELECT institute_id FROM subjects WHERE id=$1`, [id]);
    await this.ds.query(`DELETE FROM subjects WHERE id=$1`, [id]);
    if (subRows[0]?.institute_id) await this.invalidateSubjectCache(subRows[0].institute_id);
    return { success: true };
  }

  async listClassSubjects(classId: string) {
    const rows: any[] = await this.ds.query(`SELECT cs.*,s.name AS subject_name FROM class_subjects cs LEFT JOIN subjects s ON cs.subject_id=s.id WHERE cs.class_id=$1`, [classId]);
    return { success: true, data: rows };
  }

  async addClassSubject(body: any) {
    const rows: any[] = await this.ds.query(`INSERT INTO class_subjects (class_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *`, [body.classId, body.subjectId]);
    return { success: true, data: rows[0] || null };
  }

  async listTeacherSubjects(teacherId: string) {
    const rows: any[] = await this.ds.query(`SELECT ts.*,s.name AS subject_name FROM teacher_subjects ts LEFT JOIN subjects s ON ts.subject_id=s.id WHERE ts.teacher_id=$1`, [teacherId]);
    return { success: true, data: rows };
  }

  async assignTeacherSubject(body: any) {
    const rows: any[] = await this.ds.query(`INSERT INTO teacher_subjects (teacher_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *`, [body.teacherId, body.subjectId]);
    return { success: true, data: rows[0] || null };
  }
}
