import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the "Competitive Exam Prep" vertical — a self-contained set of
 * tables for AI-generated JEE/NEET-style practice content, fully separate
 * from the existing school `subjects` / `teacher_academic_assignments`
 * tables so the regular school academic system is untouched.
 *
 * Global (no institute_id — shared across every school, Super Admin owned):
 *   competitive_master_subjects / _chapters / _topics  — the shared syllabus
 *     taxonomy questions hang off, instead of free-text name matching.
 *   competitive_questions        — the verified/unverified question bank.
 *   competitive_reference_chunks — bulk question-bank PDF material that's
 *     kept as grounding passages rather than force-split into discrete
 *     questions.
 *
 * Per-institute (institute_id required — each school's own offering):
 *   competitive_subjects             — "this school offers JEE Physics for
 *     Class 11", pointing at a master subject + the school's own class.
 *   competitive_teacher_assignments  — which teacher teaches which
 *     competitive_subject (+ optional section). Deliberately not
 *     teacher_academic_assignments, so this never interferes with the
 *     existing school teaching-map.
 *   competitive_topic_grounding_links — an explicit, teacher/admin-set link
 *     from a master topic to one of the school's own topics, used to pull
 *     textbook grounding passages at generation time.
 *
 * All FKs are kept within this new table set only; columns that reference
 * pre-existing school tables (classes, sections, topics, teachers, users)
 * are plain indexed uuid columns, matching how the rest of the school
 * module already cross-references ids without formal FK constraints.
 */
export class CreateCompetitiveVertical1790400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── Global taxonomy ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_master_subjects (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        name character varying NOT NULL,
        exam_target_scope character varying NOT NULL DEFAULT 'both',
        is_active boolean NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_master_subjects" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_name
        ON competitive_master_subjects (LOWER(TRIM(name)))
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_master_chapters (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        master_subject_id uuid NOT NULL,
        name character varying NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_master_chapters" PRIMARY KEY (id),
        CONSTRAINT "FK_cmc_subject" FOREIGN KEY (master_subject_id)
          REFERENCES competitive_master_subjects (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cmc_subject ON competitive_master_chapters (master_subject_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cmc_name
        ON competitive_master_chapters (master_subject_id, LOWER(TRIM(name)))
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_master_topics (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        master_chapter_id uuid NOT NULL,
        name character varying NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_master_topics" PRIMARY KEY (id),
        CONSTRAINT "FK_cmt_chapter" FOREIGN KEY (master_chapter_id)
          REFERENCES competitive_master_chapters (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cmt_chapter ON competitive_master_topics (master_chapter_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cmt_name
        ON competitive_master_topics (master_chapter_id, LOWER(TRIM(name)))
    `);

    // ── Global question bank ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_questions (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        master_topic_id uuid,
        exam_target character varying NOT NULL,
        exam_year integer,
        difficulty character varying,
        question_type character varying NOT NULL DEFAULT 'mcq_single',
        question_text text NOT NULL,
        options jsonb NOT NULL DEFAULT '{}',
        correct_answer character varying,
        explanation text,
        source character varying NOT NULL DEFAULT 'manual',
        is_verified boolean NOT NULL DEFAULT false,
        tags jsonb NOT NULL DEFAULT '[]',
        created_by uuid,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_questions" PRIMARY KEY (id),
        CONSTRAINT "FK_cq_topic" FOREIGN KEY (master_topic_id)
          REFERENCES competitive_master_topics (id) ON DELETE SET NULL,
        CONSTRAINT "CHK_cq_source" CHECK (source IN ('pyq', 'ai_generated', 'manual'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cq_topic_verified
        ON competitive_questions (master_topic_id, is_verified)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cq_exam_year
        ON competitive_questions (exam_target, exam_year)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cq_verify_queue
        ON competitive_questions (is_verified, created_at) WHERE is_verified = false
    `);

    // ── Global reference-chunk grounding store ───────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_reference_chunks (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        subject_name character varying NOT NULL,
        chapter_name_hint character varying,
        content text NOT NULL,
        page_no integer,
        tokens integer,
        source_file character varying,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_reference_chunks" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crc_subject_chapter
        ON competitive_reference_chunks (subject_name, chapter_name_hint)
    `);

    // ── Per-institute offering ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_subjects (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        institute_id uuid NOT NULL,
        master_subject_id uuid NOT NULL,
        class_id uuid NOT NULL,
        display_name character varying,
        is_active boolean NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_subjects" PRIMARY KEY (id),
        CONSTRAINT "FK_cs_master_subject" FOREIGN KEY (master_subject_id)
          REFERENCES competitive_master_subjects (id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cs_institute ON competitive_subjects (institute_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cs_unique_offering
        ON competitive_subjects (institute_id, master_subject_id, class_id)
    `);

    // ── Per-institute teacher assignment ──────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_teacher_assignments (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        institute_id uuid NOT NULL,
        teacher_id uuid NOT NULL,
        competitive_subject_id uuid NOT NULL,
        section_id uuid,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_teacher_assignments" PRIMARY KEY (id),
        CONSTRAINT "FK_cta_subject" FOREIGN KEY (competitive_subject_id)
          REFERENCES competitive_subjects (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cta_teacher ON competitive_teacher_assignments (teacher_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cta_institute ON competitive_teacher_assignments (institute_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cta_unique
        ON competitive_teacher_assignments (teacher_id, competitive_subject_id, COALESCE(section_id::text, ''))
    `);

    // ── Grounding link: competitive topic -> the school's own topic ──────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_topic_grounding_links (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        competitive_subject_id uuid NOT NULL,
        master_topic_id uuid NOT NULL,
        school_topic_id uuid NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_topic_grounding_links" PRIMARY KEY (id),
        CONSTRAINT "FK_ctgl_subject" FOREIGN KEY (competitive_subject_id)
          REFERENCES competitive_subjects (id) ON DELETE CASCADE,
        CONSTRAINT "FK_ctgl_topic" FOREIGN KEY (master_topic_id)
          REFERENCES competitive_master_topics (id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ctgl_unique
        ON competitive_topic_grounding_links (competitive_subject_id, master_topic_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_topic_grounding_links`);
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_teacher_assignments`);
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_subjects`);
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_reference_chunks`);
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_questions`);
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_master_topics`);
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_master_chapters`);
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_master_subjects`);
  }
}
