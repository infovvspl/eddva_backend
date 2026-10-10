import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateCompetitiveSubjectDto, CreateGroundingLinkDto, UpdateCompetitiveSubjectDto } from './dto/competitive-subject.dto';

/**
 * Institute Admin: manage this institute's own competitive-subject
 * offerings ("we offer JEE Physics for Class 11") and the grounding links
 * that tell generation which of the school's own topics to ground in.
 *
 * Deliberately separate from `school-subject.service.ts` — these are new
 * tables, not a `content_type` flag bolted onto the existing `subjects`
 * table, so the existing school academic system is untouched.
 */
@Injectable()
export class CompetitiveSubjectService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  private requireInstituteId(user: any): string {
    if (!user?.instituteId) {
      throw new ForbiddenException('No institute associated with this account');
    }
    return user.instituteId;
  }

  async list(user: any) {
    const instituteId = this.requireInstituteId(user);
    const rows = await this.ds.query(
      `SELECT cs.*, ms.name AS master_subject_name, e.name AS exam_name, e.code AS exam_code,
              c.name AS class_name,
              (SELECT COUNT(*)::int FROM competitive_teacher_assignments a WHERE a.competitive_subject_id = cs.id) AS teacher_count
       FROM competitive_subjects cs
       JOIN competitive_master_subjects ms ON ms.id = cs.master_subject_id
       JOIN competitive_master_exams e ON e.id = ms.exam_id
       LEFT JOIN classes c ON c.id::text = cs.class_id::text
       WHERE cs.institute_id = $1
       ORDER BY cs.created_at DESC`,
      [instituteId],
    );
    return { data: rows };
  }

  async create(user: any, dto: CreateCompetitiveSubjectDto) {
    const instituteId = this.requireInstituteId(user);

    const masterRows = await this.ds.query(`SELECT * FROM competitive_master_subjects WHERE id = $1 AND is_active = true`, [dto.masterSubjectId]);
    if (!masterRows.length) throw new NotFoundException('Master subject not found or inactive');

    const classRows = await this.ds.query(`SELECT id FROM classes WHERE id = $1 AND institute_id = $2`, [dto.classId, instituteId]);
    if (!classRows.length) throw new BadRequestException('Class not found for this institute');

    const existing = await this.ds.query(
      `SELECT id FROM competitive_subjects WHERE institute_id = $1 AND master_subject_id = $2 AND class_id = $3`,
      [instituteId, dto.masterSubjectId, dto.classId],
    );
    if (existing.length) throw new BadRequestException('This institute already offers this subject for this class');

    const rows = await this.ds.query(
      `INSERT INTO competitive_subjects (institute_id, master_subject_id, class_id, display_name)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [instituteId, dto.masterSubjectId, dto.classId, dto.displayName ?? null],
    );
    return rows[0];
  }

  async update(user: any, id: string, dto: UpdateCompetitiveSubjectDto) {
    const existing = await this.getOwnedOrThrow(user, id);
    const rows = await this.ds.query(
      `UPDATE competitive_subjects SET display_name = $2, is_active = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, dto.displayName ?? existing.display_name, dto.isActive ?? existing.is_active],
    );
    return rows[0];
  }

  async getOwnedOrThrow(user: any, id: string) {
    const instituteId = this.requireInstituteId(user);
    const rows = await this.ds.query(`SELECT * FROM competitive_subjects WHERE id = $1 AND institute_id = $2`, [id, instituteId]);
    if (!rows.length) throw new NotFoundException('Competitive subject not found for this institute');
    return rows[0];
  }

  // ── Grounding links ─────────────────────────────────────────────────────

  async listGroundingLinks(user: any, competitiveSubjectId: string) {
    await this.getOwnedOrThrow(user, competitiveSubjectId);
    const rows = await this.ds.query(
      `SELECT l.*, t.name AS master_topic_name, st.name AS school_topic_name
       FROM competitive_topic_grounding_links l
       JOIN competitive_master_topics t ON t.id = l.master_topic_id
       LEFT JOIN topics st ON st.id::text = l.school_topic_id::text
       WHERE l.competitive_subject_id = $1`,
      [competitiveSubjectId],
    );
    return { data: rows };
  }

  async createGroundingLink(user: any, competitiveSubjectId: string, dto: CreateGroundingLinkDto) {
    const subject = await this.getOwnedOrThrow(user, competitiveSubjectId);

    const topicRows = await this.ds.query(`SELECT id FROM competitive_master_topics WHERE id = $1`, [dto.masterTopicId]);
    if (!topicRows.length) throw new NotFoundException('Master topic not found');

    const schoolTopicRows = await this.ds.query(`SELECT id FROM topics WHERE id = $1 AND institute_id = $2`, [dto.schoolTopicId, subject.institute_id]);
    if (!schoolTopicRows.length) throw new BadRequestException('School topic not found for this institute');

    const rows = await this.ds.query(
      `INSERT INTO competitive_topic_grounding_links (competitive_subject_id, master_topic_id, school_topic_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (competitive_subject_id, master_topic_id)
       DO UPDATE SET school_topic_id = EXCLUDED.school_topic_id
       RETURNING *`,
      [competitiveSubjectId, dto.masterTopicId, dto.schoolTopicId],
    );
    return rows[0];
  }
}
