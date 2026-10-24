/**
 * Tables for chapter lesson plans. Run by the school migration
 * AddChapterLessonPlans and, idempotently, by LessonPlanService on start (the
 * school DB has synchronize off and other school modules self-create the same way).
 */
export const LESSON_PLAN_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS chapter_lesson_plans (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     institute_id UUID NOT NULL,
     academic_year VARCHAR(20) NOT NULL,
     teacher_user_id UUID NOT NULL,
     class_id UUID NOT NULL,
     subject_id UUID NOT NULL,
     chapter_id UUID NOT NULL,
     section_ids UUID[] NOT NULL DEFAULT '{}',
     syllabus_plan_id UUID,
     title VARCHAR(300),
     total_periods INT NOT NULL DEFAULT 6,
     learning_objectives TEXT,
     prior_knowledge TEXT,
     methodology TEXT,
     resources TEXT,
     digital_resources TEXT,
     assessment_plan TEXT,
     homework_summary TEXT,
     expected_outcomes TEXT,
     source VARCHAR(20) NOT NULL DEFAULT 'AI',
     source_file_url TEXT,
     grounded BOOLEAN NOT NULL DEFAULT FALSE,
     grounded_pages JSONB,
     status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
     version INT NOT NULL DEFAULT 1,
     supersedes_id UUID,
     submitted_at TIMESTAMPTZ,
     reviewed_by UUID,
     reviewed_at TIMESTAMPTZ,
     review_comment TEXT,
     error TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // One approved plan, and one plan being worked on, per teacher and chapter.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_lesson_plans_approved
     ON chapter_lesson_plans (institute_id, academic_year, teacher_user_id, class_id, subject_id, chapter_id)
     WHERE status = 'APPROVED'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_lesson_plans_working
     ON chapter_lesson_plans (institute_id, academic_year, teacher_user_id, class_id, subject_id, chapter_id)
     WHERE status IN ('GENERATING', 'DRAFT', 'FAILED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED')`,
  `CREATE INDEX IF NOT EXISTS idx_chapter_lesson_plans_review
     ON chapter_lesson_plans (institute_id, status, submitted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chapter_lesson_plans_teacher
     ON chapter_lesson_plans (teacher_user_id, status)`,
  `CREATE TABLE IF NOT EXISTS chapter_lesson_plan_periods (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     plan_id UUID NOT NULL REFERENCES chapter_lesson_plans(id) ON DELETE CASCADE,
     period_no INT NOT NULL,
     title VARCHAR(300),
     objectives TEXT,
     activities TEXT,
     resources TEXT,
     assessment TEXT,
     homework TEXT,
     UNIQUE (plan_id, period_no)
   )`,
  `CREATE TABLE IF NOT EXISTS lesson_plan_progress (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     plan_id UUID NOT NULL REFERENCES chapter_lesson_plans(id) ON DELETE CASCADE,
     period_id UUID NOT NULL REFERENCES chapter_lesson_plan_periods(id) ON DELETE CASCADE,
     section_id UUID NOT NULL,
     status VARCHAR(20) NOT NULL,
     taught_on DATE,
     note TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (period_id, section_id)
   )`,
  // Schema v2 (structured plan) and reliability columns. Additive: v1 plans keep
  // working from the text columns, which v2 plans also fill (rendered).
  `ALTER TABLE chapter_lesson_plans
     ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1,
     ADD COLUMN IF NOT EXISTS content JSONB,
     ADD COLUMN IF NOT EXISTS quality_warnings JSONB NOT NULL DEFAULT '[]',
     ADD COLUMN IF NOT EXISTS period_minutes INT,
     ADD COLUMN IF NOT EXISTS revision INT NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS generation_started_at TIMESTAMPTZ,
     ADD COLUMN IF NOT EXISTS generation_ms INT`,
  `ALTER TABLE chapter_lesson_plan_periods
     ADD COLUMN IF NOT EXISTS duration_minutes INT`,
  `CREATE INDEX IF NOT EXISTS idx_chapter_lesson_plans_generating
     ON chapter_lesson_plans (generation_started_at) WHERE status = 'GENERATING'`,
  `CREATE TABLE IF NOT EXISTS lesson_plan_notes (
     plan_id UUID PRIMARY KEY REFERENCES chapter_lesson_plans(id) ON DELETE CASCADE,
     note TEXT NOT NULL DEFAULT '',
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // Uploaded plans: the text read from the teacher's file (kept so a failed
  // reading can be retried without a re-upload) and the original file name.
  `ALTER TABLE chapter_lesson_plans
     ADD COLUMN IF NOT EXISTS source_text TEXT,
     ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(255)`,
  `CREATE INDEX IF NOT EXISTS idx_lesson_plan_progress_plan ON lesson_plan_progress (plan_id)`,
];
