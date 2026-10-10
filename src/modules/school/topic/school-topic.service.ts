import { Injectable, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hasSchoolRole } from '../common/role-helper';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { S3Service } from '../../upload/s3.service';
import { isSchoolAiFeatureEnabled } from '../common/ai-features.registry';

/**
 * Tidy a chapter name so case alone cannot create a second chapter.
 *
 * Chapter titles are sentences, so short joining words stay lowercase unless
 * they lead — title-casing every word would turn "Money and Credit" into
 * "Money And Credit". A name that is already mixed case is left alone; only
 * SHOUTED names are reformatted.
 */
const CHAPTER_SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with',
]);

export function normalizeChapterName(name: string): string {
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  if (cleaned !== cleaned.toUpperCase()) return cleaned;
  return cleaned
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && CHAPTER_SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

@Injectable()
export class SchoolTopicService {
  private readonly logger = new Logger(SchoolTopicService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridge: AiBridgeService,
    private readonly s3Service: S3Service,
  ) { }

  private async validateTeacherAssignment(user: any, subjectId: string | null, action: string) {
    if (!hasSchoolRole(user.role, 'TEACHER')) return;
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
    const chapterId = query.chapterId;
    const subjectId = query.subjectId;
    let rows: any[] = [];
    try {
      if (chapterId) {
        // Auto-heal duplicate topics under the same chapter
        const dups = await this.ds.query(`
          SELECT LOWER(TRIM(name)) as norm_name, COUNT(*) as cnt
          FROM topics
          WHERE chapter_id = $1
          GROUP BY LOWER(TRIM(name))
          HAVING COUNT(*) > 1
        `, [chapterId]);

        for (const d of dups) {
          const tRows = await this.ds.query(`
            SELECT id, name, sort_order, created_at, updated_at
            FROM topics
            WHERE chapter_id = $1 AND LOWER(TRIM(name)) = $2
            ORDER BY COALESCE(sort_order,0) ASC, updated_at DESC NULLS LAST, created_at ASC
          `, [chapterId, d.norm_name]);

          const keepId = tRows[0].id;
          const keepName = tRows[0].name;
          const removeIds = tRows.slice(1).map((r) => r.id);

          for (const remId of removeIds) {
            await this.ds.query(`UPDATE study_materials SET topic_id = $1, topic = $2 WHERE topic_id = $3`, [keepId, keepName, remId]);
            await this.ds.query(`DELETE FROM topics WHERE id = $1`, [remId]);
          }
        }
      }

      let sql: string;
      const params: any[] = [];
      if (chapterId) {
        sql = `
          SELECT DISTINCT ON (LOWER(TRIM(t.name))) t.id, t.name, t.chapter_id, COALESCE(t.sort_order, 0) as sort_order, t.created_at, t.updated_at
          FROM topics t
          WHERE t.chapter_id = $1
          ORDER BY LOWER(TRIM(t.name)), t.updated_at DESC NULLS LAST, t.created_at ASC
        `;
        params.push(chapterId);
      } else if (subjectId) {
        // All topics across every chapter of this subject in one call — filter dropdowns
        // and similar "full curriculum list" views need this instead of one chapter at a
        // time. Dedup is per (chapter, name) so the same topic name in different chapters
        // isn't incorrectly collapsed into one row.
        sql = `
          SELECT DISTINCT ON (t.chapter_id, LOWER(TRIM(t.name))) t.id, t.name, t.chapter_id, c.name as chapter_name,
                 COALESCE(t.sort_order, 0) as sort_order, t.created_at, t.updated_at
          FROM topics t
          JOIN chapters c ON t.chapter_id = c.id
          WHERE c.subject_id = $1
          ORDER BY t.chapter_id, LOWER(TRIM(t.name)), t.updated_at DESC NULLS LAST, t.created_at ASC
        `;
        params.push(subjectId);
      } else {
        sql = `
          SELECT DISTINCT ON (LOWER(TRIM(t.name))) t.id, t.name, t.chapter_id, COALESCE(t.sort_order, 0) as sort_order, t.created_at, t.updated_at
          FROM topics t
          WHERE 1=1
          ORDER BY LOWER(TRIM(t.name)), t.updated_at DESC NULLS LAST, t.created_at ASC
        `;
      }

      const rawRows: any[] = await this.ds.query(sql, params);

      // Preserve natural curriculum topic order: sort by sort_order first, then update time, then creation timestamp
      rows = rawRows.sort((a, b) => {
        const orderA = Number(a.sort_order || 0);
        const orderB = Number(b.sort_order || 0);
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        const updatedA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const updatedB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        if (updatedA !== updatedB) {
          return updatedB - updatedA;
        }
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeA - timeB;
      });
    } catch (e) {
      console.error('[listTopics] Error:', e);
      rows = [];
    }

    return { success: true, data: rows };
  }

  async createTopic(user: any, body: any) {
    // Resolve: chapter -> subject_id and institute_id
    const chapRows = await this.ds.query(`SELECT subject_id, institute_id FROM chapters WHERE id=$1`, [body.chapterId]);
    const resolvedSubjectId = chapRows.length > 0 ? chapRows[0].subject_id : null;
    const resolvedInstituteId = chapRows.length > 0 ? chapRows[0].institute_id : null;
    this.logger.log(`[TRACE] createTopic | body.chapterId=${body.chapterId} | resolvedSubjectId=${resolvedSubjectId} | user.id=${user?.id}`);
    await this.validateTeacherAssignment(user, resolvedSubjectId, 'CREATE_TOPIC_DENIED');

    const rawOrder = body.orderIndex ?? body.order;
    const parsedOrder = rawOrder !== undefined && rawOrder !== null ? Number(rawOrder) : 0;

    const rows: any[] = await this.ds.query(
      `INSERT INTO topics (chapter_id,institute_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.chapterId, resolvedInstituteId, body.name, isNaN(parsedOrder) ? 0 : parsedOrder]
    );
    return { success: true, data: rows[0] };
  }

  async updateTopic(user: any, id: string, body: any) {
    // Resolve: topic -> chapter -> subject_id
    let topRows = await this.ds.query(`SELECT t.id, t.name, t.chapter_id, c.subject_id FROM topics t JOIN chapters c ON t.chapter_id = c.id WHERE t.id=$1`, [id]);
    if (topRows.length === 0 && body.chapterId && body.name) {
      topRows = await this.ds.query(
        `SELECT t.id, t.name, t.chapter_id, c.subject_id FROM topics t JOIN chapters c ON t.chapter_id = c.id WHERE t.chapter_id=$1 AND LOWER(TRIM(t.name))=LOWER(TRIM($2))`,
        [body.chapterId, body.name]
      );
    }
    const targetId = topRows.length > 0 ? topRows[0].id : id;
    const oldTopicName = topRows.length > 0 ? topRows[0].name : null;
    const chapterId = topRows.length > 0 ? topRows[0].chapter_id : body.chapterId;
    const resolvedSubjectId = topRows.length > 0 ? topRows[0].subject_id : null;
    await this.validateTeacherAssignment(user, resolvedSubjectId, 'UPDATE_TOPIC_DENIED');

    const newTopicName = body.name ? body.name.trim() : null;
    const rawOrder = body.orderIndex ?? body.order;
    const parsedOrder = rawOrder !== undefined && rawOrder !== null ? Number(rawOrder) : null;

    if (parsedOrder !== null && !isNaN(parsedOrder) && chapterId) {
      const currentTopics: any[] = await this.ds.query(
        `SELECT id, sort_order FROM topics WHERE chapter_id=$1 ORDER BY COALESCE(sort_order,0) ASC, updated_at DESC NULLS LAST, created_at ASC`,
        [chapterId]
      );

      const otherTopics = currentTopics.filter((t) => t.id !== targetId);
      const targetPos = Math.max(1, Math.min(parsedOrder, otherTopics.length + 1));
      otherTopics.splice(targetPos - 1, 0, { id: targetId });

      for (let i = 0; i < otherTopics.length; i++) {
        const top = otherTopics[i];
        const newOrder = i + 1;
        if (top.id === targetId) {
          await this.ds.query(
            `UPDATE topics SET name=COALESCE($2,name), sort_order=$3, updated_at=NOW() WHERE id=$1`,
            [targetId, newTopicName, newOrder]
          );
        } else {
          await this.ds.query(
            `UPDATE topics SET sort_order=$2 WHERE id=$1`,
            [top.id, newOrder]
          );
        }
      }
    } else {
      await this.ds.query(
        `UPDATE topics SET name=COALESCE($2,name), updated_at=NOW() WHERE id=$1`,
        [targetId, newTopicName]
      );
    }

    // Sync study_materials topic strings & IDs
    if (newTopicName) {
      if (oldTopicName) {
        await this.ds.query(
          `UPDATE study_materials SET topic=$2, topic_id=$1 WHERE topic_id=$1 OR (chapter_id=$3 AND LOWER(TRIM(topic))=LOWER(TRIM($4)))`,
          [targetId, newTopicName, chapterId, oldTopicName]
        );
      } else {
        await this.ds.query(
          `UPDATE study_materials SET topic=$2, topic_id=$1 WHERE topic_id=$1`,
          [targetId, newTopicName]
        );
      }
    }

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
    const subjectId = query.subjectId;
    const subjectName = query.subjectName;
    const classId = query.classId;
    const sectionId = query.sectionId;

    let rows: any[] = [];
    try {
      if (subjectId) {
        // Auto-heal duplicate chapter records in chapters table
        const dups = await this.ds.query(`
          SELECT LOWER(TRIM(name)) as norm_name, COUNT(*) as cnt
          FROM chapters
          WHERE subject_id = $1
          GROUP BY LOWER(TRIM(name))
          HAVING COUNT(*) > 1
        `, [subjectId]);

        for (const d of dups) {
          // Rank the indexed duplicate first: keeping a chapter with no passages
          // while deleting the one a PDF was actually ingested against is how a
          // chapter silently loses its grounding (or, worse, how another chapter's
          // passages end up matched to it — see getChapterPassages' by-name
          // fallback in SchoolTextbookService).
          const cRows = await this.ds.query(`
            SELECT c.id, c.name, c.sort_order, c.created_at, c.updated_at,
                   COALESCE(ts.chunk_count, 0) AS chunk_count
            FROM chapters c
            LEFT JOIN textbook_sources ts ON ts.chapter_id = c.id
            WHERE c.subject_id = $1 AND LOWER(TRIM(c.name)) = $2
            ORDER BY COALESCE(ts.chunk_count, 0) DESC,
                     COALESCE(c.sort_order, 0) ASC, c.updated_at DESC NULLS LAST, c.created_at ASC
          `, [subjectId, d.norm_name]);

          const keepId = cRows[0].id;
          const keepName = normalizeChapterName(cRows[0].name);

          await this.ds.query(`UPDATE chapters SET name = $2 WHERE id = $1`, [keepId, keepName]);

          const removeIds = cRows.slice(1).map((r) => r.id);
          for (const remId of removeIds) {
            await this.ds.query(`UPDATE topics SET chapter_id = $1 WHERE chapter_id = $2`, [keepId, remId]);
            await this.ds.query(`UPDATE study_materials SET chapter_id = $1, chapter = $2 WHERE chapter_id = $3`, [keepId, keepName, remId]);

            // Repoint the loser's indexed passages onto the survivor instead of
            // orphaning them — the chapter row about to be deleted may be the one
            // a PDF was actually ingested against. Grounding tables are an
            // enhancement layer here, so a missing table must not abort the heal.
            try {
              await this.ds.query(`UPDATE textbook_chunks SET chapter_id = $1 WHERE chapter_id = $2`, [keepId, remId]);
              await this.ds.query(`UPDATE textbook_link_status SET chapter_id = $1 WHERE chapter_id = $2`, [keepId, remId]);
              // textbook_sources.chapter_id is the primary key, so it cannot be
              // repointed onto a survivor that already has a row of its own.
              const keepHasSource = await this.ds.query(
                `SELECT 1 FROM textbook_sources WHERE chapter_id = $1 LIMIT 1`, [keepId],
              );
              if (keepHasSource.length) {
                await this.ds.query(`DELETE FROM textbook_sources WHERE chapter_id = $1`, [remId]);
              } else {
                await this.ds.query(`UPDATE textbook_sources SET chapter_id = $1 WHERE chapter_id = $2`, [keepId, remId]);
              }
            } catch (err) {
              this.logger.warn(`Chapter merge: could not repoint grounding data for ${remId} -> ${keepId}: ${(err as Error).message}`);
            }

            await this.ds.query(`DELETE FROM chapters WHERE id = $1`, [remId]);
          }
        }

        // Auto-heal / sync linked study_materials
        await this.ds.query(
          `UPDATE study_materials sm
           SET chapter_id = c.id, chapter = c.name
           FROM chapters c
           WHERE sm.chapter_id IS NULL
             AND sm.subject_id_fk = $1
             AND c.subject_id = $1
             AND LOWER(TRIM(sm.chapter)) = LOWER(TRIM(c.name))`,
          [subjectId]
        );
      }

      let sql = `
        SELECT DISTINCT ON (LOWER(TRIM(name))) id, name, sort_order, created_at, updated_at FROM (
          SELECT c.id, c.name, COALESCE(c.sort_order, 0) as sort_order, c.created_at, c.updated_at, 1 as source_priority
          FROM chapters c
          JOIN subjects s ON c.subject_id = s.id
          WHERE 1=1
          ${subjectId ? `AND c.subject_id = $1` : ''}
          ${classId ? `AND (s.class_id = '${classId}' OR s.class_id IS NULL)` : ''}

          UNION ALL

          SELECT COALESCE(sm.chapter_id, sm.id) as id, sm.chapter as name, COALESCE(sm.sort_order, 0) as sort_order, sm.created_at, sm.created_at as updated_at, 2 as source_priority
          FROM study_materials sm
          WHERE sm.chapter IS NOT NULL AND TRIM(sm.chapter) != ''
            AND sm.chapter_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM chapters c2
              WHERE c2.subject_id = sm.subject_id_fk
                AND LOWER(TRIM(c2.name)) = LOWER(TRIM(sm.chapter))
            )
          ${subjectId ? `AND sm.subject_id_fk = $1` : ''}
          ${classId ? `AND (sm.class_id = '${classId}' OR sm.class_id IS NULL)` : ''}
          ${sectionId ? `AND (sm.section_id = '${sectionId}' OR sm.section_id IS NULL)` : ''}
        ) combined
        ORDER BY LOWER(TRIM(name)), source_priority ASC, created_at ASC
      `;

      const params: any[] = [];
      if (subjectId) params.push(subjectId);

      const rawRows: any[] = await this.ds.query(sql, params);

      // Preserve textbook chapter order: sort by sort_order first, then update time, then creation timestamp
      rows = rawRows.sort((a, b) => {
        const orderA = Number(a.sort_order || 0);
        const orderB = Number(b.sort_order || 0);
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        const updatedA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const updatedB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        if (updatedA !== updatedB) {
          return updatedB - updatedA;
        }
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeA - timeB;
      });
    } catch (e) {
      console.error('[listChapters UNION] Error:', e);
      rows = [];
    }

    // Annotate each chapter with whether its textbook has been indexed, so the
    // teacher panel can show an "Indexed" badge. A chapter counts as indexed
    // when a textbook_sources row for it carries chunks — matched by id OR by
    // name within the subject, because duplicate chapter rows (same name,
    // different id) can split the indexed id from the one shown here (the same
    // fallback getChapterPassages uses for grounding).
    if (rows.length) {
      try {
        const idxRows: any[] = await this.ds.query(
          `SELECT c.id::text AS id, LOWER(TRIM(c.name)) AS norm_name
           FROM textbook_sources ts
           JOIN chapters c ON c.id::text = ts.chapter_id::text
           WHERE COALESCE(ts.chunk_count, 0) > 0
             ${subjectId ? 'AND c.subject_id = $1' : ''}`,
          subjectId ? [subjectId] : [],
        );
        const indexedIds = new Set(idxRows.map((r) => String(r.id)));
        const indexedNames = new Set(idxRows.map((r) => String(r.norm_name || '')));
        rows = rows.map((r) => ({
          ...r,
          indexed:
            indexedIds.has(String(r.id)) ||
            indexedNames.has(String(r.name || '').trim().toLowerCase()),
        }));
      } catch (e) {
        // Textbook tables may not exist yet (nothing indexed); the badge just
        // won't show. Never let this break the chapter list.
        rows = rows.map((r) => ({ ...r, indexed: false }));
      }
    }

    return { success: true, data: rows };
  }

  async createChapter(user: any, body: any) {
    // payload contains: subjectId
    await this.validateTeacherAssignment(user, body.subjectId, 'CREATE_CHAPTER_DENIED');

    let instituteId = body.instituteId || null;
    if (!instituteId) {
      const subRows = await this.ds.query(`SELECT institute_id FROM subjects WHERE id=$1`, [body.subjectId]);
      instituteId = subRows.length > 0 ? subRows[0].institute_id : (user.instituteId || null);
    }

    const name = normalizeChapterName(body.name);
    if (!name) throw new BadRequestException('Chapter name is required');

    const existing = await this.ds.query(
      `SELECT id FROM chapters WHERE subject_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) LIMIT 1`,
      [body.subjectId, name],
    );
    if (existing.length) {
      throw new BadRequestException('A chapter with this name already exists for this subject.');
    }

    const rawOrder = body.orderIndex ?? body.order;
    const parsedOrder = rawOrder !== undefined && rawOrder !== null ? Number(rawOrder) : 0;

    const rows: any[] = await this.ds.query(
      `INSERT INTO chapters (subject_id,institute_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.subjectId, instituteId, name, isNaN(parsedOrder) ? 0 : parsedOrder]
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

    const chapterOrder: string[] = [];
    const grouped = new Map<string, string[]>();
    for (const r of rawRows) {
      const chapter = String(r?.chapter ?? '').trim();
      if (!chapter) continue;
      if (!grouped.has(chapter)) { grouped.set(chapter, []); chapterOrder.push(chapter); }
      const topicRaw = String(r?.topic ?? '').trim();
      if (!topicRaw) continue;
      const parts = topicRaw.split(',');
      const list = grouped.get(chapter)!;
      for (const part of parts) {
        const topic = part.trim();
        if (!topic) continue;
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

      for (const rawChapterName of chapterOrder) {
        const chapterName = normalizeChapterName(rawChapterName);
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

  /**
   * Scan a photographed/scanned textbook table-of-contents page into a
   * chapter → topics structure for the teacher to review and edit before
   * committing it via bulkImport() above — this step never writes to the
   * database itself. Upload/AI failures surface as a clear error; a readable
   * image that just doesn't look like an index page comes back as an empty
   * `chapters` array with a `warning`, not an error, so the UI can offer
   * "try a clearer photo" instead of a scary failure.
   */
  async parseIndexImage(user: any, file: Express.Multer.File, language?: string) {
    if (!isSchoolAiFeatureEnabled(user, 'ai_curriculum_import')) {
      throw new ForbiddenException('AI curriculum import is not enabled for your institute');
    }
    if (!file?.buffer?.length) throw new BadRequestException('No image uploaded');

    const instituteId = user?.instituteId || 'default';
    const safeName = (file.originalname || 'index.jpg').replace(/[^a-zA-Z0-9.\-_]/g, '') || 'index.jpg';
    const key = `tenants/${instituteId}/curriculum-import/${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;

    let imageUrl: string;
    try {
      imageUrl = await this.s3Service.upload(key, file.buffer, file.mimetype || 'image/jpeg');
    } catch (e) {
      this.logger.error(`[parseIndexImage] upload failed: ${e instanceof Error ? e.message : e}`);
      throw new BadRequestException('Could not upload the image — please try again');
    }

    const result = await this.aiBridge.parseCurriculumIndexImage({ imageUrl, language }, user?.instituteId);
    return {
      success: true,
      data: { chapters: result?.chapters || [], warning: result?.warning },
    };
  }

  async updateChapter(user: any, id: string, body: any) {
    // Resolve: chapter -> subject_id
    let chapRows = await this.ds.query(`SELECT id, name, subject_id FROM chapters WHERE id=$1`, [id]);
    let oldChapterName: string | null = chapRows.length > 0 ? chapRows[0].name : null;

    if (chapRows.length === 0) {
      // If virtual ID from study_materials, resolve string chapter & subject
      const smRows = await this.ds.query(
        `SELECT chapter, subject_id_fk FROM study_materials WHERE (chapter_id=$1 OR id::text=$1) AND chapter IS NOT NULL LIMIT 1`,
        [id]
      );
      if (smRows.length > 0) {
        const smChapter = smRows[0].chapter;
        const smSubjectId = smRows[0].subject_id_fk || body.subjectId;
        oldChapterName = smChapter;
        chapRows = await this.ds.query(
          `SELECT id, name, subject_id FROM chapters WHERE subject_id=$1 AND LOWER(TRIM(name))=LOWER(TRIM($2))`,
          [smSubjectId, smChapter]
        );
      }
    }

    const resolvedSubjectId = chapRows.length > 0 ? chapRows[0].subject_id : (body.subjectId || null);
    if (chapRows.length === 0 && resolvedSubjectId && body.name) {
      chapRows = await this.ds.query(
        `SELECT id, name, subject_id FROM chapters WHERE subject_id=$1 AND LOWER(TRIM(name))=LOWER(TRIM($2))`,
        [resolvedSubjectId, body.name]
      );
    }

    await this.validateTeacherAssignment(user, resolvedSubjectId, 'UPDATE_CHAPTER_DENIED');

    const newChapterName = body.name ? normalizeChapterName(body.name) : null;
    const rawOrder = body.orderIndex ?? body.order;
    const parsedOrder = rawOrder !== undefined && rawOrder !== null ? Number(rawOrder) : null;

    let targetId = chapRows.length > 0 ? chapRows[0].id : null;

    // If target chapter does not exist in chapters table yet, insert or locate it
    if (!targetId && resolvedSubjectId && (newChapterName || oldChapterName)) {
      const createName = newChapterName || oldChapterName!;
      const subRows = await this.ds.query(`SELECT institute_id FROM subjects WHERE id=$1`, [resolvedSubjectId]);
      const instituteId = subRows.length > 0 ? subRows[0].institute_id : (user.instituteId || null);
      
      const existingChap = await this.ds.query(
        `SELECT id FROM chapters WHERE subject_id=$1 AND LOWER(TRIM(name))=LOWER(TRIM($2)) LIMIT 1`,
        [resolvedSubjectId, createName]
      );
      if (existingChap.length > 0) {
        targetId = existingChap[0].id;
      } else {
        const ins = await this.ds.query(
          `INSERT INTO chapters (subject_id, institute_id, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`,
          [resolvedSubjectId, instituteId, createName, parsedOrder || 1]
        );
        targetId = ins[0].id;
      }
    }

    if (targetId) {
      if (parsedOrder !== null && !isNaN(parsedOrder) && resolvedSubjectId) {
        const currentChapters: any[] = await this.ds.query(
          `SELECT id, sort_order FROM chapters WHERE subject_id=$1 ORDER BY COALESCE(sort_order,0) ASC, updated_at DESC NULLS LAST, created_at ASC`,
          [resolvedSubjectId]
        );

        const otherChapters = currentChapters.filter((c) => c.id !== targetId);
        const targetPos = Math.max(1, Math.min(parsedOrder, otherChapters.length + 1));
        otherChapters.splice(targetPos - 1, 0, { id: targetId });

        for (let i = 0; i < otherChapters.length; i++) {
          const ch = otherChapters[i];
          const newOrder = i + 1;
          if (ch.id === targetId) {
            await this.ds.query(
              `UPDATE chapters SET name=COALESCE($2,name), sort_order=$3, updated_at=NOW() WHERE id=$1`,
              [targetId, newChapterName, newOrder]
            );
          } else {
            await this.ds.query(
              `UPDATE chapters SET sort_order=$2 WHERE id=$1`,
              [ch.id, newOrder]
            );
          }
        }
      } else if (newChapterName) {
        await this.ds.query(
          `UPDATE chapters SET name=$2, updated_at=NOW() WHERE id=$1`,
          [targetId, newChapterName]
        );
      }

      // Sync study_materials chapter strings & chapter_id references
      const syncName = newChapterName || oldChapterName;
      if (syncName) {
        if (oldChapterName) {
          await this.ds.query(
            `UPDATE study_materials SET chapter=$2, chapter_id=$1 WHERE chapter_id=$1 OR (subject_id_fk=$3 AND LOWER(TRIM(chapter))=LOWER(TRIM($4)))`,
            [targetId, syncName, resolvedSubjectId, oldChapterName]
          );
        } else {
          await this.ds.query(
            `UPDATE study_materials SET chapter=$2, chapter_id=$1 WHERE chapter_id=$1`,
            [targetId, syncName]
          );
        }
      }
    }

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
