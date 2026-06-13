import { Injectable, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolTopicService {
  private readonly logger = new Logger(SchoolTopicService.name);

  constructor(@InjectDataSource('school') private readonly ds: DataSource) { }

  private async validateTeacherAssignment(user: any, subjectId: string | null, action: string) {
    if (user.role !== 'TEACHER') return;
    if (!subjectId) {
      this.logger.warn(`[AUDIT] Action: ${action} | Role: ${user.role} | Teacher: ${user.id} | Status: DENIED | Reason: Missing subject context`);
      throw new ForbiddenException('Subject context is required for teacher actions');
    }
    this.logger.log(`[DEBUG validateTeacherAssignment] user.id=${user.id}, subjectId=${subjectId}, action=${action}`);
    const rows = await this.ds.query(
      `SELECT 1 FROM teacher_academic_assignments taa
       JOIN teachers t ON t.id = taa.teacher_id
       WHERE t.user_id=$1 AND taa.subject_id=$2`,
      [user.id, subjectId]
    );
    this.logger.log(`[DEBUG validateTeacherAssignment] rows found: ${rows.length}`);
    if (rows.length === 0) {
      this.logger.warn(`[AUDIT] Action: ${action} | Role: ${user.role} | Teacher: ${user.id} | Subject: ${subjectId} | Timestamp: ${new Date().toISOString()} | Status: DENIED`);
      throw new ForbiddenException('Teacher is not assigned to this subject');
    }
  }

  async listTopics(query: any) {
    let sql = `SELECT * FROM topics WHERE 1=1`;
    const params: any[] = [];
    if (query.chapterId) { params.push(query.chapterId); sql += ` AND chapter_id=$${params.length}`; }
    const rows: any[] = await this.ds.query(sql + ` ORDER BY sort_order, name`, params);
    return { success: true, data: rows };
  }

  async createTopic(user: any, body: any) {
    // Resolve: chapter -> subject_id and institute_id
    const chapRows = await this.ds.query(`SELECT subject_id, institute_id FROM chapters WHERE id=$1`, [body.chapterId]);
    const resolvedSubjectId = chapRows.length > 0 ? chapRows[0].subject_id : null;
    const resolvedInstituteId = chapRows.length > 0 ? chapRows[0].institute_id : null;
    this.logger.log(`[TRACE] createTopic | body.chapterId=${body.chapterId} | resolvedSubjectId=${resolvedSubjectId} | user.id=${user?.id}`);
    await this.validateTeacherAssignment(user, resolvedSubjectId, 'CREATE_TOPIC_DENIED');

    const rows: any[] = await this.ds.query(
      `INSERT INTO topics (chapter_id,institute_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.chapterId, resolvedInstituteId, body.name, body.orderIndex || 0]
    );
    return { success: true, data: rows[0] };
  }

  async updateTopic(user: any, id: string, body: any) {
    // Resolve: topic -> chapter -> subject_id
    const topRows = await this.ds.query(`SELECT c.subject_id FROM topics t JOIN chapters c ON t.chapter_id = c.id WHERE t.id=$1`, [id]);
    const resolvedSubjectId = topRows.length > 0 ? topRows[0].subject_id : null;
    await this.validateTeacherAssignment(user, resolvedSubjectId, 'UPDATE_TOPIC_DENIED');

    await this.ds.query(
      `UPDATE topics SET name=COALESCE($2,name),sort_order=COALESCE($3,sort_order),updated_at=NOW() WHERE id=$1`,
      [id, body.name, body.orderIndex]
    );
    return { success: true };
  }

  async deleteTopic(user: any, id: string) {
    const topRows = await this.ds.query(`SELECT c.subject_id FROM topics t JOIN chapters c ON t.chapter_id = c.id WHERE t.id=$1`, [id]);
    const resolvedSubjectId = topRows.length > 0 ? topRows[0].subject_id : null;
    await this.validateTeacherAssignment(user, resolvedSubjectId, 'DELETE_TOPIC_DENIED');

    await this.ds.transaction(async (manager) => {
      await manager.query(`DELETE FROM study_materials WHERE topic_id=$1`, [id]);
      await manager.query(`DELETE FROM topics WHERE id=$1`, [id]);
    });
    return { success: true };
  }

  async listChapters(query: any) {
    let sql = `SELECT * FROM chapters WHERE 1=1`;
    const params: any[] = [];
    if (query.subjectId) { params.push(query.subjectId); sql += ` AND subject_id=$${params.length}`; }
    if (query.instituteId) { params.push(query.instituteId); sql += ` AND institute_id=$${params.length}`; }
    const rows: any[] = await this.ds.query(sql + ` ORDER BY sort_order, name`, params);
    return { success: true, data: rows };
  }

  async createChapter(user: any, body: any) {
    // payload contains: subjectId
    await this.validateTeacherAssignment(user, body.subjectId, 'CREATE_CHAPTER_DENIED');

    // Resolve institute_id: prefer body, then look up from subject, then fall back to user
    let instituteId = body.instituteId || null;
    if (!instituteId) {
      const subRows = await this.ds.query(`SELECT institute_id FROM subjects WHERE id=$1`, [body.subjectId]);
      instituteId = subRows.length > 0 ? subRows[0].institute_id : (user.instituteId || null);
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO chapters (subject_id,institute_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.subjectId, instituteId, body.name, body.orderIndex || 0]
    );
    return { success: true, data: rows[0] };
  }

  /**
   * Bulk import curriculum (chapters + topics) for one subject.
   * Accepts flat rows `[{ chapter, topic? }]` (as parsed from a CSV/sheet).
   * Chapters and topics are matched case-insensitively by name — existing ones
   * are reused (never duplicated), new ones are appended after the current order.
   * Everything runs in a single transaction.
   */
  async bulkImport(user: any, body: any) {
    const subjectId: string | undefined = body?.subjectId;
    if (!subjectId) throw new BadRequestException('subjectId is required');

    const rawRows: Array<{ chapter?: string; topic?: string }> = Array.isArray(body?.rows) ? body.rows : [];
    if (!rawRows.length) throw new BadRequestException('No rows to import');

    await this.validateTeacherAssignment(user, subjectId, 'BULK_IMPORT_DENIED');

    const subRows = await this.ds.query(`SELECT institute_id FROM subjects WHERE id=$1`, [subjectId]);
    if (!subRows.length) throw new BadRequestException('Subject not found');
    const instituteId = subRows[0].institute_id || user.instituteId || null;

    // Group rows by chapter, preserving first-seen order; dedupe topics per chapter.
    const chapterOrder: string[] = [];
    const grouped = new Map<string, string[]>();
    for (const r of rawRows) {
      const chapter = String(r?.chapter ?? '').trim();
      if (!chapter) continue;
      if (!grouped.has(chapter)) { grouped.set(chapter, []); chapterOrder.push(chapter); }
      const topic = String(r?.topic ?? '').trim();
      if (topic) {
        const list = grouped.get(chapter)!;
        if (!list.some((t) => t.toLowerCase() === topic.toLowerCase())) list.push(topic);
      }
    }
    if (!chapterOrder.length) throw new BadRequestException('No valid chapter names found');

    const summary = { chaptersCreated: 0, chaptersExisting: 0, topicsCreated: 0, topicsExisting: 0 };

    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const maxRows = await qr.query(`SELECT COALESCE(MAX(sort_order),0) AS m FROM chapters WHERE subject_id=$1`, [subjectId]);
      let nextChapterOrder = Number(maxRows[0]?.m) || 0;

      for (const chapterName of chapterOrder) {
        let chapterId: string;
        const existing = await qr.query(
          `SELECT id FROM chapters WHERE subject_id=$1 AND LOWER(name)=LOWER($2) LIMIT 1`,
          [subjectId, chapterName],
        );
        if (existing.length) {
          chapterId = existing[0].id;
          summary.chaptersExisting++;
        } else {
          nextChapterOrder++;
          const ins = await qr.query(
            `INSERT INTO chapters (subject_id,institute_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING id`,
            [subjectId, instituteId, chapterName, nextChapterOrder],
          );
          chapterId = ins[0].id;
          summary.chaptersCreated++;
        }

        const topicMax = await qr.query(`SELECT COALESCE(MAX(sort_order),0) AS m FROM topics WHERE chapter_id=$1`, [chapterId]);
        let nextTopicOrder = Number(topicMax[0]?.m) || 0;
        for (const topicName of grouped.get(chapterName)!) {
          const tExist = await qr.query(
            `SELECT 1 FROM topics WHERE chapter_id=$1 AND LOWER(name)=LOWER($2) LIMIT 1`,
            [chapterId, topicName],
          );
          if (tExist.length) { summary.topicsExisting++; continue; }
          nextTopicOrder++;
          await qr.query(
            `INSERT INTO topics (chapter_id,institute_id,name,sort_order) VALUES ($1,$2,$3,$4)`,
            [chapterId, instituteId, topicName, nextTopicOrder],
          );
          summary.topicsCreated++;
        }
      }
      await qr.commitTransaction();
    } catch (e) {
      await qr.rollbackTransaction();
      this.logger.error(`[bulkImport] failed: ${e instanceof Error ? e.message : e}`);
      throw e;
    } finally {
      await qr.release();
    }

    return { success: true, data: summary };
  }

  async updateChapter(user: any, id: string, body: any) {
    // Resolve: chapter -> subject_id
    const chapRows = await this.ds.query(`SELECT subject_id FROM chapters WHERE id=$1`, [id]);
    const resolvedSubjectId = chapRows.length > 0 ? chapRows[0].subject_id : null;
    await this.validateTeacherAssignment(user, resolvedSubjectId, 'UPDATE_CHAPTER_DENIED');

    await this.ds.query(
      `UPDATE chapters SET name=COALESCE($2,name),sort_order=COALESCE($3,sort_order),updated_at=NOW() WHERE id=$1`,
      [id, body.name, body.orderIndex]
    );
    return { success: true };
  }

  async deleteChapter(user: any, id: string) {
    const chapRows = await this.ds.query(`SELECT subject_id FROM chapters WHERE id=$1`, [id]);
    const resolvedSubjectId = chapRows.length > 0 ? chapRows[0].subject_id : null;
    await this.validateTeacherAssignment(user, resolvedSubjectId, 'DELETE_CHAPTER_DENIED');

    await this.ds.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM study_materials
         WHERE chapter_id=$1
            OR topic_id IN (SELECT id FROM topics WHERE chapter_id=$1)`,
        [id],
      );
      await manager.query(`DELETE FROM topics WHERE chapter_id=$1`, [id]);
      await manager.query(`DELETE FROM chapters WHERE id=$1`, [id]);
    });
    return { success: true };
  }
}
