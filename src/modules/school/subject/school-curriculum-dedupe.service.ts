import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { normalizeSubjectName } from './school-subject.service';

/**
 * Curriculum de-duplication.
 *
 * A subject can exist twice for the same class — the create guard compares
 * section_id with IS NULL, and in SQL NULL never equals NULL, so a class-wide
 * subject does not collide with a section-scoped one. Chapter bulk-import then
 * reuses chapters only within one subject_id, so re-running the same chapter
 * sheet against the second subject creates a parallel set. The result is every
 * chapter appearing twice, differing only in case.
 *
 * Reporting and merging are separate on purpose. This moves live curriculum —
 * materials, indexed textbooks, teacher assignments — so the caller sees exactly
 * what would move before anything does, and names the groups to merge.
 */

/**
 * The name a merged chapter should keep.
 *
 * Chapter titles are sentences, not labels, so title-casing every word turns
 * "Money and Credit" into "Money And Credit". Prefer a variant that a human
 * already cased properly — i.e. one that is not shouting — and only fall back to
 * reformatting when every variant is upper case.
 */
export function bestChapterName(names: string[]): string {
  const cleaned = names.map((n) => String(n || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (!cleaned.length) return '';

  const mixedCase = cleaned.find((n) => n !== n.toUpperCase());
  if (mixedCase) return mixedCase;

  // All variants are upper case: sentence-case it, keeping short joining words
  // lowercase unless they start the title.
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return cleaned[0]
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** A table/column pair to repoint, plus how to clear conflicts first. */
type Ref = { table: string; column: string };

/** Everything pointing at subjects.id. Extends the 14 in migration 1780600000000. */
const SUBJECT_REFS: Ref[] = [
  { table: 'teacher_academic_assignments', column: 'subject_id' },
  { table: 'timetables', column: 'subject_id' },
  { table: 'assignments', column: 'subject_id' },
  { table: 'assessments', column: 'subject_id' },
  { table: 'study_materials', column: 'subject_id_fk' },
  { table: 'chapters', column: 'subject_id' },
  { table: 'class_recordings', column: 'subject_id' },
  { table: 'class_subjects', column: 'subject_id' },
  { table: 'schedules', column: 'subject_id' },
  { table: 'student_doubts', column: 'subject_id' },
  { table: 'teacher_subjects', column: 'subject_id' },
  { table: 'attendance_sessions', column: 'subject_id' },
  { table: 'school_game_sessions', column: 'subject_id' },
  // Added since that migration was written.
  { table: 'school_game_skills', column: 'subject_id' },
  { table: 'school_game_seen_questions', column: 'subject_id' },
  { table: 'school_live_lectures', column: 'subject_id' },
  { table: 'textbook_chunks', column: 'subject_id' },
];

/** Everything pointing at chapters.id. */
const CHAPTER_REFS: Ref[] = [
  { table: 'topics', column: 'chapter_id' },
  { table: 'study_materials', column: 'chapter_id' },
  { table: 'assessments', column: 'chapter_id' },
  { table: 'class_recordings', column: 'chapter_id' },
  { table: 'textbook_chunks', column: 'chapter_id' },
  { table: 'textbook_link_status', column: 'chapter_id' },
  { table: 'school_game_sessions', column: 'chapter_id' },
  { table: 'school_game_skills', column: 'chapter_id' },
];

@Injectable()
export class SchoolCurriculumDedupeService {
  private readonly logger = new Logger(SchoolCurriculumDedupeService.name);

  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  /** Staff act on their own institute; a super-admin has none and must name one. */
  private resolveInstitute(user: any, requestedId?: string | null): string {
    const isSuper = String(user?.role || '').toUpperCase() === 'SUPER_ADMIN';
    const id = isSuper ? (requestedId || user?.instituteId) : user?.instituteId;
    if (!id) {
      throw new BadRequestException(
        isSuper ? 'instituteId is required' : 'Institute context is required',
      );
    }
    return id;
  }

  /** Does this table/column exist here? Environments differ, and a missing table
   *  must be skipped rather than abort a merge. */
  private async columnExists(table: string, column: string): Promise<boolean> {
    const rows = await this.ds.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column],
    );
    return rows.length > 0;
  }

  /**
   * The subset of `wanted` that this table really has, as a SQL column list.
   *
   * Conflict keys cannot be hard-coded: teacher_subjects carries section_id in
   * some deployments and not others, and referencing a missing column aborts the
   * whole merge transaction.
   */
  private async presentColumns(table: string, wanted: string[]): Promise<string> {
    const rows = await this.ds.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND column_name = ANY($2::text[])`,
      [table, wanted],
    );
    const present = wanted.filter((w) => rows.some((r: any) => r.column_name === w));
    if (!present.length) throw new Error(`${table} has none of: ${wanted.join(', ')}`);
    return present.join(', ');
  }

  // ── Report ────────────────────────────────────────────────────────────────

  /**
   * Duplicate subjects for an institute, with what hangs off each side so the
   * proposed canonical can be checked. Read-only.
   */
  async findDuplicates(user: any, forInstituteId?: string) {
    const instituteId = this.resolveInstitute(user, forInstituteId);

    const rows = await this.ds.query(
      `SELECT s.id, s.name, s.class_id AS "classId", s.section_id AS "sectionId",
              cl.name AS "className", s.created_at AS "createdAt",
              (SELECT count(*)::int FROM chapters c WHERE c.subject_id = s.id) AS chapters,
              (SELECT count(*)::int FROM topics t JOIN chapters c ON c.id = t.chapter_id
                 WHERE c.subject_id = s.id) AS topics,
              (SELECT count(*)::int FROM study_materials sm JOIN chapters c ON c.id = sm.chapter_id
                 WHERE c.subject_id = s.id) AS materials,
              (SELECT count(*)::int FROM chapters c JOIN textbook_sources ts ON ts.chapter_id = c.id
                 WHERE c.subject_id = s.id AND ts.chunk_count > 0) AS "indexedChapters",
              (SELECT count(*)::int FROM teacher_academic_assignments taa
                 WHERE taa.subject_id = s.id) AS "teacherAssignments"
       FROM subjects s
       LEFT JOIN classes cl ON cl.id = s.class_id
       WHERE s.institute_id::text = $1::text
       ORDER BY s.created_at`,
      [instituteId],
    );

    // Group on the scope the create guard *should* have used, with NULLs made
    // comparable — that is precisely the hole these duplicates came through.
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      const key = [
        r.classId ?? '-', r.sectionId ?? '-', normalizeSubjectName(r.name).toLowerCase(),
      ].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    const duplicates = [];
    for (const [key, members] of groups) {
      if (members.length < 2) continue;
      const canonical = this.pickCanonicalSubject(members);
      duplicates.push({
        groupKey: key,
        subjectName: normalizeSubjectName(members[0].name),
        className: members[0].className,
        canonicalId: canonical.id,
        canonicalReason: this.canonicalReason(canonical, members),
        members: members.map((m) => ({ ...m, isCanonical: m.id === canonical.id })),
        chapterMerges: await this.previewChapterMerges(members.map((m) => m.id)),
      });
    }

    return {
      instituteId,
      duplicateGroups: duplicates.length,
      subjectsInvolved: duplicates.reduce((n, g) => n + g.members.length, 0),
      groups: duplicates,
    };
  }

  /**
   * Which row survives. Not "oldest wins": the newer row is often the one in
   * active use, and losing its indexed textbooks would silently break grounding.
   */
  private pickCanonicalSubject(members: any[]): any {
    return [...members].sort((a, b) =>
      (b.indexedChapters - a.indexedChapters) ||
      (b.materials - a.materials) ||
      (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    )[0];
  }

  private canonicalReason(canonical: any, members: any[]): string {
    if (canonical.indexedChapters > 0 && members.some((m) => m.id !== canonical.id && m.indexedChapters === 0)) {
      return `has ${canonical.indexedChapters} indexed chapter(s)`;
    }
    if (members.some((m) => m.id !== canonical.id && m.materials < canonical.materials)) {
      return `has the most materials (${canonical.materials})`;
    }
    return 'oldest of the group';
  }

  /** Which chapters would merge into which, once the subjects are one. */
  private async previewChapterMerges(subjectIds: string[]) {
    const chapters = await this.ds.query(
      `SELECT c.id, c.name, c.subject_id AS "subjectId",
              (SELECT count(*)::int FROM study_materials sm WHERE sm.chapter_id = c.id) AS materials,
              COALESCE((SELECT ts.chunk_count FROM textbook_sources ts WHERE ts.chapter_id = c.id), 0) AS passages
       FROM chapters c
       WHERE c.subject_id::text = ANY($1::text[])
       ORDER BY c.name`,
      [subjectIds],
    );

    const byName = new Map<string, any[]>();
    for (const c of chapters) {
      const key = String(c.name || '').trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(c);
    }

    const merges = [];
    for (const [, list] of byName) {
      if (list.length < 2) continue;
      const keep = this.pickCanonicalChapter(list);
      merges.push({
        finalName: bestChapterName(list.map((c: any) => c.name)),
        keepId: keep.id,
        keepPassages: keep.passages,
        mergeIds: list.filter((c) => c.id !== keep.id).map((c) => c.id),
        names: list.map((c) => c.name),
      });
    }
    return merges;
  }

  /** Keep the indexed chapter — losing its passages would break grounding. */
  private pickCanonicalChapter(list: any[]): any {
    return [...list].sort((a, b) => (b.passages - a.passages) || (b.materials - a.materials))[0];
  }

  // ── Merge ─────────────────────────────────────────────────────────────────

  /**
   * Merge the named groups. Each group runs in its own transaction, so one bad
   * group cannot leave another half-merged.
   */
  async mergeGroups(user: any, groupKeys: string[], forInstituteId?: string) {
    if (!Array.isArray(groupKeys) || !groupKeys.length) {
      throw new BadRequestException('groupKeys is required — merge only what the report listed');
    }
    const report = await this.findDuplicates(user, forInstituteId);
    const wanted = report.groups.filter((g: any) => groupKeys.includes(g.groupKey));
    if (!wanted.length) {
      throw new BadRequestException('None of those groups are currently duplicated');
    }

    const results = [];
    for (const group of wanted) {
      const runner = this.ds.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        const losers = group.members.filter((m: any) => !m.isCanonical).map((m: any) => m.id);
        for (const loser of losers) {
          await this.repointSubject(runner, group.canonicalId, loser);
        }
        const chapterMerges = await this.mergeChaptersOf(runner, group.canonicalId);
        await runner.commitTransaction();

        this.logger.log(
          `Merged ${losers.length} duplicate subject(s) into ${group.canonicalId} ` +
          `(${group.subjectName}, ${group.className}); ${chapterMerges} chapter pair(s) merged`,
        );
        results.push({
          groupKey: group.groupKey,
          subjectName: group.subjectName,
          className: group.className,
          canonicalId: group.canonicalId,
          subjectsRemoved: losers.length,
          chaptersMerged: chapterMerges,
        });
      } catch (err) {
        await runner.rollbackTransaction();
        this.logger.error(`Merge failed for ${group.groupKey}: ${(err as Error).message}`);
        results.push({ groupKey: group.groupKey, failed: true, error: (err as Error).message });
      } finally {
        await runner.release();
      }
    }
    return { merged: results.filter((r: any) => !r.failed).length, results };
  }

  /** Repoint every subject reference, clearing conflicts the target already has. */
  private async repointSubject(runner: any, canonicalId: string, duplicateId: string) {
    for (const ref of SUBJECT_REFS) {
      if (!(await this.columnExists(ref.table, ref.column))) continue;

      // Tables with their own uniqueness would raise on a blind UPDATE, so drop
      // the duplicate's row wherever the canonical already covers that key.
      if (ref.table === 'class_subjects') {
        await runner.query(
          `DELETE FROM class_subjects WHERE subject_id::text = $1::text
             AND class_id IN (SELECT class_id FROM class_subjects WHERE subject_id::text = $2::text)`,
          [duplicateId, canonicalId],
        );
      } else if (ref.table === 'teacher_subjects') {
        // section_id is not present in every deployment of this table, so the
        // conflict key is built from the columns that actually exist.
        const key = await this.presentColumns('teacher_subjects', ['teacher_id', 'section_id']);
        await runner.query(
          `DELETE FROM teacher_subjects WHERE subject_id::text = $1::text
             AND (${key}) IN (SELECT ${key} FROM teacher_subjects WHERE subject_id::text = $2::text)`,
          [duplicateId, canonicalId],
        );
      } else if (ref.table === 'teacher_academic_assignments') {
        const key = await this.presentColumns(
          'teacher_academic_assignments', ['teacher_id', 'class_id', 'section_id'],
        );
        await runner.query(
          `DELETE FROM teacher_academic_assignments WHERE subject_id::text = $1::text
             AND (${key}) IN (SELECT ${key} FROM teacher_academic_assignments
                              WHERE subject_id::text = $2::text)`,
          [duplicateId, canonicalId],
        );
      } else if (ref.table === 'school_game_skills') {
        // Unique on (student_user_id, subject_id, COALESCE(chapter_id,…), game_type).
        const key = await this.presentColumns(
          'school_game_skills', ['student_user_id', 'game_type'],
        );
        await runner.query(
          `DELETE FROM school_game_skills WHERE subject_id::text = $1::text
             AND (${key}, COALESCE(chapter_id::text,'')) IN (
               SELECT ${key}, COALESCE(chapter_id::text,'') FROM school_game_skills
               WHERE subject_id::text = $2::text)`,
          [duplicateId, canonicalId],
        );
      }

      await runner.query(
        `UPDATE ${ref.table} SET ${ref.column} = $1 WHERE ${ref.column}::text = $2::text`,
        [canonicalId, duplicateId],
      );
    }
    await runner.query(`DELETE FROM subjects WHERE id::text = $1::text`, [duplicateId]);
  }

  /**
   * Collapse same-named chapters now sitting under one subject.
   *
   * The existing cleanup migration stops at repointing chapters.subject_id, which
   * would leave the subject holding both copies of every chapter — the state the
   * coverage screen surfaces as duplicates.
   */
  private async mergeChaptersOf(runner: any, subjectId: string): Promise<number> {
    const chapters = await runner.query(
      `SELECT c.id, c.name,
              COALESCE((SELECT ts.chunk_count FROM textbook_sources ts WHERE ts.chapter_id = c.id), 0) AS passages,
              (SELECT count(*)::int FROM study_materials sm WHERE sm.chapter_id = c.id) AS materials
       FROM chapters c WHERE c.subject_id::text = $1::text`,
      [subjectId],
    );

    const byName = new Map<string, any[]>();
    for (const c of chapters) {
      const key = String(c.name || '').trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(c);
    }

    let merged = 0;
    for (const [, list] of byName) {
      const keep = this.pickCanonicalChapter(list);
      for (const loser of list.filter((c) => c.id !== keep.id)) {
        await this.repointChapter(runner, keep.id, loser.id);
        merged++;
      }
      // Tidy the casing that made the duplicates obvious in the first place.
      const finalName = bestChapterName(list.map((c: any) => c.name));
      if (finalName && finalName !== keep.name) {
        await runner.query(`UPDATE chapters SET name = $1 WHERE id::text = $2::text`, [finalName, keep.id]);
      }
    }
    return merged;
  }

  private async repointChapter(runner: any, keepId: string, loserId: string) {
    for (const ref of CHAPTER_REFS) {
      if (!(await this.columnExists(ref.table, ref.column))) continue;

      if (ref.table === 'school_game_skills') {
        const key = await this.presentColumns(
          'school_game_skills', ['student_user_id', 'subject_id', 'game_type'],
        );
        await runner.query(
          `DELETE FROM school_game_skills WHERE chapter_id::text = $1::text
             AND (${key}) IN (SELECT ${key} FROM school_game_skills
                              WHERE chapter_id::text = $2::text)`,
          [loserId, keepId],
        );
      }

      await runner.query(
        `UPDATE ${ref.table} SET ${ref.column} = $1 WHERE ${ref.column}::text = $2::text`,
        [keepId, loserId],
      );
    }

    // textbook_sources.chapter_id is the primary key, so the row cannot simply be
    // repointed when the survivor already has one — that would collide.
    if (await this.columnExists('textbook_sources', 'chapter_id')) {
      const existing = await runner.query(
        `SELECT 1 FROM textbook_sources WHERE chapter_id::text = $1::text LIMIT 1`,
        [keepId],
      );
      if (existing.length) {
        await runner.query(`DELETE FROM textbook_sources WHERE chapter_id::text = $1::text`, [loserId]);
      } else {
        await runner.query(
          `UPDATE textbook_sources SET chapter_id = $1 WHERE chapter_id::text = $2::text`,
          [keepId, loserId],
        );
      }
    }

    await runner.query(`DELETE FROM chapters WHERE id::text = $1::text`, [loserId]);
  }
}
