import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AssignTeacherDto } from './dto/competitive-subject.dto';

/**
 * Institute Admin: assign/unassign a teacher to a competitive subject.
 *
 * Deliberately a dedicated table (`competitive_teacher_assignments`), not
 * `teacher_academic_assignments` — this assignment flow is fully
 * independent of the existing school teaching-map and can't interfere
 * with it.
 */
@Injectable()
export class CompetitiveAssignmentService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private requireInstituteId(user: any): string {
    if (!user?.instituteId) throw new ForbiddenException('No institute associated with this account');
    return user.instituteId;
  }

  async listForSubject(user: any, competitiveSubjectId: string) {
    const instituteId = this.requireInstituteId(user);
    await this.getSubjectOrThrow(instituteId, competitiveSubjectId);
    const rows = await this.ds.query(
      `SELECT a.*, u.name AS teacher_name, u.email AS teacher_email, sec.name AS section_name
       FROM competitive_teacher_assignments a
       JOIN teachers t ON t.id = a.teacher_id
       JOIN users u ON u.id = t.user_id
       LEFT JOIN sections sec ON sec.id::text = a.section_id::text
       WHERE a.competitive_subject_id = $1
       ORDER BY a.created_at DESC`,
      [competitiveSubjectId],
    );
    return { data: rows };
  }

  async listForTeacher(user: any) {
    // Teachers list their own assignments — not institute-admin scoped.
    const rows = await this.ds.query(
      `SELECT a.*, cs.display_name, cs.class_id, ms.name AS master_subject_name, c.name AS class_name
       FROM competitive_teacher_assignments a
       JOIN competitive_subjects cs ON cs.id = a.competitive_subject_id
       JOIN competitive_master_subjects ms ON ms.id = cs.master_subject_id
       LEFT JOIN classes c ON c.id::text = cs.class_id::text
       JOIN teachers t ON t.id = a.teacher_id
       WHERE t.user_id = $1 AND cs.is_active = true
       ORDER BY a.created_at DESC`,
      [user.id],
    );
    return { data: rows };
  }

  async assign(user: any, competitiveSubjectId: string, dto: AssignTeacherDto) {
    const instituteId = this.requireInstituteId(user);
    await this.getSubjectOrThrow(instituteId, competitiveSubjectId);

    const teacherRows = await this.ds.query(`SELECT id FROM teachers WHERE id = $1 AND institute_id = $2`, [dto.teacherId, instituteId]);
    if (!teacherRows.length) throw new BadRequestException('Teacher not found for this institute');

    if (dto.sectionId) {
      const sectionRows = await this.ds.query(`SELECT id FROM sections WHERE id = $1`, [dto.sectionId]);
      if (!sectionRows.length) throw new BadRequestException('Section not found');
    }

    const rows = await this.ds.query(
      `INSERT INTO competitive_teacher_assignments (institute_id, teacher_id, competitive_subject_id, section_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (teacher_id, competitive_subject_id, COALESCE(section_id::text, ''))
       DO NOTHING
       RETURNING *`,
      [instituteId, dto.teacherId, competitiveSubjectId, dto.sectionId ?? null],
    );
    return rows[0] ?? { message: 'Teacher is already assigned to this competitive subject/section' };
  }

  async unassign(user: any, competitiveSubjectId: string, assignmentId: string) {
    const instituteId = this.requireInstituteId(user);
    await this.getSubjectOrThrow(instituteId, competitiveSubjectId);
    const rows = await this.ds.query(
      `DELETE FROM competitive_teacher_assignments WHERE id = $1 AND competitive_subject_id = $2 RETURNING id`,
      [assignmentId, competitiveSubjectId],
    );
    if (!rows.length) throw new NotFoundException('Assignment not found');
    return { success: true };
  }

  /** Used by the generation flow to confirm a teacher may generate for this subject. */
  async assertTeacherAssigned(userId: string, competitiveSubjectId: string): Promise<void> {
    const rows = await this.ds.query(
      `SELECT a.id FROM competitive_teacher_assignments a
       JOIN teachers t ON t.id = a.teacher_id
       WHERE t.user_id = $1 AND a.competitive_subject_id = $2`,
      [userId, competitiveSubjectId],
    );
    if (!rows.length) {
      throw new ForbiddenException('You are not assigned to teach this competitive subject');
    }
  }

  private async getSubjectOrThrow(instituteId: string, id: string) {
    const rows = await this.ds.query(`SELECT * FROM competitive_subjects WHERE id = $1 AND institute_id = $2`, [id, instituteId]);
    if (!rows.length) throw new NotFoundException('Competitive subject not found for this institute');
    return rows[0];
  }
}
