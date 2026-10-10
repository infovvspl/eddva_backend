import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Student: read-only visibility into the competitive subjects active for
 * their own class. Visibility follows class membership exactly like the
 * rest of the school vertical — no separate enrollment step, no
 * student-specific assignment table.
 */
@Injectable()
export class CompetitiveStudentService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async listForStudent(user: any) {
    const classId = user?.studentProfile?.classId;
    const instituteId = user?.instituteId;
    if (!classId || !instituteId) {
      throw new ForbiddenException('No class on record for this student');
    }

    const rows = await this.ds.query(
      `SELECT cs.id, cs.display_name, ms.name AS master_subject_name, e.name AS exam_name, e.code AS exam_code,
              (SELECT COUNT(*)::int FROM competitive_teacher_assignments a WHERE a.competitive_subject_id = cs.id) AS teacher_count
       FROM competitive_subjects cs
       JOIN competitive_master_subjects ms ON ms.id = cs.master_subject_id
       JOIN competitive_master_exams e ON e.id = ms.exam_id
       WHERE cs.institute_id = $1 AND cs.class_id = $2 AND cs.is_active = true
       ORDER BY ms.name`,
      [instituteId, classId],
    );
    return { data: rows };
  }
}
