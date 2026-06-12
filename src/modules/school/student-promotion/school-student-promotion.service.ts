import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolStudentPromotionService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private resolveInstituteId(user: any, explicitInstituteId?: string): string {
    if (user.role === 'SUPER_ADMIN') {
      if (!explicitInstituteId && !user.instituteId) {
        throw new BadRequestException('instituteId is required');
      }
      return explicitInstituteId || user.instituteId;
    }
    if (!user.instituteId) throw new BadRequestException('Institute ID could not be determined');
    return user.instituteId;
  }

  async overview(user: any, query: any = {}) {
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    const params: any[] = [instituteId];
    let yearFilter = '';
    if (query.academicYear) {
      params.push(query.academicYear);
      yearFilter = ` AND c.academic_year = $${params.length}`;
    }

    const rows: any[] = await this.ds.query(
      `SELECT c.id AS class_id, c.name AS class_name, c.academic_year,
              sec.id AS section_id, sec.name AS section_name,
              COUNT(st.id)::int AS total_students,
              COUNT(st.id) FILTER (WHERE u.is_active = TRUE)::int AS active_students,
              COUNT(st.id) FILTER (WHERE u.is_active = FALSE)::int AS inactive_students
       FROM classes c
       LEFT JOIN sections sec ON sec.class_id = c.id
       LEFT JOIN students st ON st.section_id = sec.id
       LEFT JOIN users u ON u.id = st.user_id
       WHERE c.institute_id = $1${yearFilter}
       GROUP BY c.id, c.name, c.academic_year, sec.id, sec.name
       ORDER BY c.name, sec.name`,
      params,
    );

    const classes = new Map<string, any>();
    for (const row of rows) {
      if (!classes.has(row.class_id)) {
        classes.set(row.class_id, {
          id: row.class_id,
          name: row.class_name,
          academicYear: row.academic_year,
          sections: [],
          totalStudents: 0,
          activeStudents: 0,
          inactiveStudents: 0,
        });
      }
      const cls = classes.get(row.class_id);
      cls.totalStudents += Number(row.total_students || 0);
      cls.activeStudents += Number(row.active_students || 0);
      cls.inactiveStudents += Number(row.inactive_students || 0);
      if (row.section_id) {
        cls.sections.push({
          id: row.section_id,
          name: row.section_name,
          totalStudents: Number(row.total_students || 0),
          activeStudents: Number(row.active_students || 0),
          inactiveStudents: Number(row.inactive_students || 0),
        });
      }
    }

    return { success: true, data: { classes: Array.from(classes.values()) } };
  }

  async sectionStudents(user: any, sectionId: string, query: any = {}) {
    const instituteId = this.resolveInstituteId(user, query.instituteId);
    await this.ensureSectionBelongsToInstitute(sectionId, instituteId);

    const params: any[] = [sectionId, instituteId];
    let filter = `st.section_id = $1 AND st.institute_id = $2`;

    if (query.includeInactive !== 'true') {
      filter += ` AND u.is_active = TRUE`;
    }
    if (query.search) {
      params.push(`%${String(query.search).trim().toLowerCase()}%`);
      filter += ` AND (
        LOWER(u.name) LIKE $${params.length}
        OR LOWER(u.email) LIKE $${params.length}
        OR LOWER(st.enrollment_no) LIKE $${params.length}
        OR LOWER(COALESCE(st.roll_no, '')) LIKE $${params.length}
      )`;
    }

    const students: any[] = await this.ds.query(
      `SELECT u.id, u.name, u.email, u.phone, u.profile_image, u.is_active,
              st.id AS profile_id, st.enrollment_no, st.roll_no,
              st.section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name
       FROM students st
       JOIN users u ON u.id = st.user_id
       LEFT JOIN sections sec ON sec.id = st.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       WHERE ${filter}
       ORDER BY NULLIF(regexp_replace(COALESCE(st.roll_no, ''), '\\D', '', 'g'), '')::int NULLS LAST, u.name`,
      params,
    );

    return {
      success: true,
      data: students.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        profileImage: row.profile_image,
        isActive: row.is_active,
        studentProfile: {
          id: row.profile_id,
          enrollmentNo: row.enrollment_no,
          rollNo: row.roll_no,
          sectionId: row.section_id,
          sectionName: row.section_name,
          classId: row.class_id,
          className: row.class_name,
        },
      })),
    };
  }

  async promote(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const fromSectionId = body.fromSectionId;
    const toSectionId = body.toSectionId;
    const studentIds = Array.isArray(body.studentIds) ? body.studentIds.filter(Boolean) : [];

    if (!fromSectionId || !toSectionId) {
      throw new BadRequestException('Source and destination sections are required');
    }
    if (fromSectionId === toSectionId) {
      throw new BadRequestException('Destination section must be different from source section');
    }
    if (!studentIds.length) {
      throw new BadRequestException('Select at least one student to promote');
    }

    const [source, destination] = await Promise.all([
      this.ensureSectionBelongsToInstitute(fromSectionId, instituteId),
      this.ensureSectionBelongsToInstitute(toSectionId, instituteId),
    ]);

    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const rows: any[] = await queryRunner.query(
        `SELECT st.user_id, st.section_id, u.name, u.is_active
         FROM students st
         JOIN users u ON u.id = st.user_id
         WHERE st.institute_id = $1 AND st.user_id = ANY($2::uuid[])`,
        [instituteId, studentIds],
      );

      const found = new Map(rows.map((row) => [row.user_id, row]));
      const promotable: string[] = [];
      const skipped: any[] = [];
      const includeInactive = body.includeInactive === true;

      for (const studentId of studentIds) {
        const row = found.get(studentId);
        if (!row) {
          skipped.push({ id: studentId, reason: 'Student not found in this institute' });
        } else if (row.section_id !== fromSectionId) {
          skipped.push({ id: studentId, name: row.name, reason: 'Student is no longer in the source section' });
        } else if (!includeInactive && !row.is_active) {
          skipped.push({ id: studentId, name: row.name, reason: 'Inactive student skipped' });
        } else {
          promotable.push(studentId);
        }
      }

      if (promotable.length) {
        await queryRunner.query(
          `UPDATE students
           SET section_id = $1, updated_at = NOW()
           WHERE institute_id = $2 AND user_id = ANY($3::uuid[])`,
          [toSectionId, instituteId, promotable],
        );
      }

      await queryRunner.commitTransaction();

      return {
        success: true,
        message: `${promotable.length} student(s) promoted`,
        data: {
          promotedCount: promotable.length,
          requestedCount: studentIds.length,
          skippedCount: skipped.length,
          skipped,
          source,
          destination,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async ensureSectionBelongsToInstitute(sectionId: string, instituteId: string) {
    const rows: any[] = await this.ds.query(
      `SELECT sec.id AS section_id, sec.name AS section_name,
              c.id AS class_id, c.name AS class_name, c.academic_year
       FROM sections sec
       JOIN classes c ON c.id = sec.class_id
       WHERE sec.id = $1 AND c.institute_id = $2`,
      [sectionId, instituteId],
    );
    if (!rows.length) throw new NotFoundException('Section not found for this institute');
    const row = rows[0];
    return {
      sectionId: row.section_id,
      sectionName: row.section_name,
      classId: row.class_id,
      className: row.class_name,
      academicYear: row.academic_year,
    };
  }
}
