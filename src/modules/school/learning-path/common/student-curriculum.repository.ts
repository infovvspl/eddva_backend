import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChapterRef, TopicRef } from '../engine/mastery-engine';
import { ChapterRow, TopicUnit } from '../home/mind-map';

export interface StudentIdentity {
  studentId: string;
  userId: string;
  instituteId: string | null;
  sectionId: string;
  classId: string;
  className: string | null;
}

export interface TopicContext {
  topicId: string;
  topicName: string;
  chapterId: string;
  chapterName: string;
  subjectId: string;
  subjectName: string;
}

const STUDENT_SELECT = `
  SELECT s.id AS student_id, s.user_id, s.institute_id, s.section_id, sec.class_id, c.name AS class_name
    FROM students s
    JOIN sections sec ON sec.id::text = s.section_id::text
    LEFT JOIN classes c ON c.id::text = sec.class_id::text`;

/** Read-only access to who a student is and which topics their curriculum covers. */
@Injectable()
export class StudentCurriculumRepository {
  private readonly existingTables = new Set<string>();

  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async findStudent(studentId: string): Promise<StudentIdentity | null> {
    const rows = await this.ds.query(`${STUDENT_SELECT} WHERE s.id::text = $1::text`, [studentId]);
    return rows.length ? this.toIdentity(rows[0]) : null;
  }

  async findStudentByUserId(userId: string): Promise<StudentIdentity | null> {
    const rows = await this.ds.query(`${STUDENT_SELECT} WHERE s.user_id::text = $1::text`, [userId]);
    return rows.length ? this.toIdentity(rows[0]) : null;
  }

  /**
   * A roadmap topic (the learning path's unit of learning: AI-generated,
   * see RoadmapService) with its names, but only if its chapter belongs to
   * this student's subjects.
   */
  async findRoadmapTopic(student: StudentIdentity, topicId: string): Promise<TopicContext | null> {
    const subjectIds = await this.subjectIds(student);
    if (!subjectIds.length) return null;
    const rows = await this.ds.query(
      `SELECT t.id::text AS topic_id, t.name AS topic_name, t.ord, c.id::text AS chapter_id, c.name AS chapter_name,
              s.id::text AS subject_id, s.name AS subject_name
         FROM learning_roadmap_topics t
         JOIN chapters c ON c.id = t.chapter_id
         JOIN subjects s ON s.id::text = c.subject_id::text
        WHERE t.id::text = $1::text AND s.id::text = ANY($2::text[])`,
      [topicId, subjectIds],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      topicId: r.topic_id,
      topicName: r.topic_name,
      chapterId: r.chapter_id,
      chapterName: r.chapter_name,
      subjectId: r.subject_id,
      subjectName: r.subject_name,
    };
  }

  /**
   * One subtopic, with its own name and its parent topic's full context, but
   * only if its chapter belongs to this student's subjects and it is still
   * active (mirrors findRoadmapTopic).
   */
  async findRoadmapSubtopic(student: StudentIdentity, subtopicId: string): Promise<{ id: string; name: string; topic: TopicContext } | null> {
    const subjectIds = await this.subjectIds(student);
    if (!subjectIds.length) return null;
    const rows = await this.ds.query(
      `SELECT rs.id::text AS subtopic_id, rs.name AS subtopic_name,
              t.id::text AS topic_id, t.name AS topic_name, c.id::text AS chapter_id, c.name AS chapter_name,
              s.id::text AS subject_id, s.name AS subject_name
         FROM learning_roadmap_subtopics rs
         JOIN learning_roadmap_topics t ON t.id = rs.roadmap_topic_id
         JOIN chapters c ON c.id = t.chapter_id
         JOIN subjects s ON s.id::text = c.subject_id::text
        WHERE rs.id::text = $1::text AND rs.active AND s.id::text = ANY($2::text[])`,
      [subtopicId, subjectIds],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.subtopic_id,
      name: r.subtopic_name,
      topic: {
        topicId: r.topic_id,
        topicName: r.topic_name,
        chapterId: r.chapter_id,
        chapterName: r.chapter_name,
        subjectId: r.subject_id,
        subjectName: r.subject_name,
      },
    };
  }

  /**
   * The student's chapters and the topics their mastery is judged on: every
   * roadmap topic, plus each recorded topic no roadmap covers yet (so a weak
   * topic can be noticed before any roadmap exists, and then get its own).
   */
  async loadCurriculum(student: StudentIdentity): Promise<{ topics: TopicRef[]; chapters: ChapterRef[] }> {
    const chapters = await this.loadChapters(student);
    const subjectOf = new Map(chapters.map((c) => [c.chapterId, c.subjectId]));
    const units = await this.loadTopicUnits(chapters.map((c) => c.chapterId));
    return {
      chapters: chapters.map((c) => ({ chapterId: c.chapterId, subjectId: c.subjectId })),
      topics: units.map((u) => ({ topicId: u.id, chapterId: u.chapterId, subjectId: subjectOf.get(u.chapterId)! })),
    };
  }

  /**
   * Units of learning in these chapters: roadmap topics (ord set when part of
   * a chapter roadmap, NULL when made by a topic roadmap) and recorded topics
   * no roadmap covers yet.
   */
  async loadTopicUnits(chapterIds: string[]): Promise<TopicUnit[]> {
    if (!chapterIds.length) return [];
    const rows = await this.ds.query(
      `SELECT t.id::text AS id, t.chapter_id::text AS chapter_id, t.name, t.ord,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object('id', rs.id, 'name', rs.name) ORDER BY rs.ord)
                   FROM learning_roadmap_subtopics rs WHERE rs.roadmap_topic_id = t.id AND rs.active),
                '[]'::jsonb
              ) AS subtopics,
              'roadmap' AS kind
         FROM learning_roadmap_topics t
        WHERE t.chapter_id::text = ANY($1::text[])
       UNION ALL
       SELECT ct.id::text, ct.chapter_id::text, ct.name, NULL::int, '[]'::jsonb, 'recorded'
         FROM topics ct
        WHERE ct.chapter_id::text = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM learning_roadmap_topic_links l WHERE l.curriculum_topic_id = ct.id)`,
      [chapterIds],
    );
    return rows.map((r: any) => ({
      id: r.id,
      chapterId: r.chapter_id,
      name: String(r.name ?? '').trim(),
      ord: r.ord === null ? null : Number(r.ord),
      subtopics: Array.isArray(r.subtopics) ? r.subtopics.map((s: any) => ({ id: s.id, name: String(s.name ?? '').trim() })) : [],
      kind: r.kind,
    }));
  }

  /** The student's subjects and chapters with names and order, for the mind map. */
  async loadChapters(student: StudentIdentity): Promise<ChapterRow[]> {
    const subjectIds = await this.subjectIds(student);
    if (!subjectIds.length) return [];
    const rows = await this.ds.query(
      `SELECT s.id::text AS subject_id, s.name AS subject_name,
              c.id::text AS chapter_id, c.name AS chapter_name, COALESCE(c.sort_order, 0) AS chapter_order
         FROM subjects s
         JOIN chapters c ON c.subject_id::text = s.id::text
        WHERE s.id::text = ANY($1::text[])
        ORDER BY s.name, chapter_order, c.name`,
      [subjectIds],
    );
    return rows.map((r: any) => ({
      subjectId: r.subject_id,
      subjectName: r.subject_name,
      chapterId: r.chapter_id,
      chapterName: r.chapter_name,
      chapterOrder: Number(r.chapter_order),
    }));
  }

  private async subjectIds(student: StudentIdentity): Promise<string[]> {
    const subjects: { id: string }[] = await this.ds.query(
      `SELECT DISTINCT sub.id
         FROM subjects sub
        WHERE sub.class_id::text = $1::text
          AND (sub.section_id IS NULL OR sub.section_id::text = $2::text)
       UNION
       SELECT DISTINCT scoped.id
         FROM teacher_academic_assignments taa
         JOIN subjects assigned_sub ON assigned_sub.id::text = taa.subject_id::text
         JOIN subjects scoped
           ON LOWER(TRIM(scoped.name)) = LOWER(TRIM(assigned_sub.name))
          AND scoped.class_id::text = $1::text
          AND (scoped.section_id IS NULL OR scoped.section_id::text = $2::text)
        WHERE taa.class_id::text = $1::text
          AND taa.section_id::text = $2::text`,
      [student.classId, student.sectionId],
    );
    return subjects.map((s) => String(s.id));
  }

  /** Topics the student has already opened study material for. */
  async studiedTopicIds(studentId: string): Promise<Set<string>> {
    if (!(await this.tableExists('school_ai_study_sessions'))) return new Set();
    const rows = await this.ds.query(
      `SELECT DISTINCT topic_id FROM school_ai_study_sessions WHERE student_id::text = $1::text`,
      [studentId],
    );
    return new Set(rows.map((r: any) => String(r.topic_id)));
  }

  /** Several tables this module reads are created lazily by other modules. Only a positive answer is cached. */
  async tableExists(table: string): Promise<boolean> {
    if (this.existingTables.has(table)) return true;
    const rows = await this.ds.query(`SELECT to_regclass($1) AS t`, [`public.${table}`]);
    const exists = !!rows?.[0]?.t;
    if (exists) this.existingTables.add(table);
    return exists;
  }

  private toIdentity(r: any): StudentIdentity {
    return {
      studentId: String(r.student_id),
      userId: String(r.user_id),
      instituteId: r.institute_id ? String(r.institute_id) : null,
      sectionId: String(r.section_id),
      classId: String(r.class_id),
      className: r.class_name ? String(r.class_name) : null,
    };
  }
}
