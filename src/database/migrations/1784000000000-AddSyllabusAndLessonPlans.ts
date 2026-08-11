import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyllabusAndLessonPlans1784000000000 implements MigrationInterface {
  name = 'AddSyllabusAndLessonPlans1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "syllabus_plans" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "institute_id" UUID NOT NULL,
        "academic_year" VARCHAR(50) NOT NULL,
        "class_id" UUID NOT NULL,
        "section_id" UUID,
        "subject_id" UUID NOT NULL,
        "chapter_id" UUID,
        "topic_id" UUID,
        "teacher_id" UUID,
        "planned_start_date" DATE NOT NULL,
        "planned_completion_date" DATE NOT NULL,
        "planned_periods" INT DEFAULT 1,
        "priority" VARCHAR(20) DEFAULT 'NORMAL',
        "term" VARCHAR(50),
        "status" VARCHAR(50) DEFAULT 'PLANNED',
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "lesson_plans" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "institute_id" UUID NOT NULL,
        "academic_year" VARCHAR(50) NOT NULL,
        "class_id" UUID NOT NULL,
        "section_id" UUID NOT NULL,
        "subject_id" UUID NOT NULL,
        "chapter_id" UUID,
        "topic_id" UUID,
        "teacher_id" UUID NOT NULL,
        "date" DATE NOT NULL,
        "duration_periods" INT DEFAULT 1,
        "learning_objectives" TEXT,
        "previous_knowledge" TEXT,
        "teaching_methodology" TEXT,
        "teaching_activities" TEXT,
        "teaching_resources" TEXT,
        "digital_resources" TEXT,
        "classroom_activities" TEXT,
        "assessment_method" TEXT,
        "homework" TEXT,
        "expected_learning_outcomes" TEXT,
        "teacher_notes" TEXT,
        "timetable_id" UUID,
        "status" VARCHAR(50) DEFAULT 'DRAFT',
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "lesson_completions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "lesson_plan_id" UUID NOT NULL,
        "actual_date" DATE NOT NULL,
        "actual_duration_periods" INT DEFAULT 1,
        "topics_covered" TEXT,
        "learning_objectives_achieved" TEXT,
        "student_understanding_rating" INT DEFAULT 4,
        "homework_assigned" TEXT,
        "assessment_conducted" TEXT,
        "teacher_reflection" TEXT,
        "completion_type" VARCHAR(50) DEFAULT 'FULLY',
        "delay_reason" TEXT,
        "carry_forward_date" DATE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "lesson_templates" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "institute_id" UUID,
        "teacher_id" UUID,
        "title" VARCHAR(255) NOT NULL,
        "category" VARCHAR(100) DEFAULT 'Standard',
        "content_json" JSONB DEFAULT '{}',
        "is_global" BOOLEAN DEFAULT FALSE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS "idx_syllabus_plans_inst" ON "syllabus_plans" ("institute_id");
      CREATE INDEX IF NOT EXISTS "idx_syllabus_plans_class" ON "syllabus_plans" ("class_id");
      CREATE INDEX IF NOT EXISTS "idx_syllabus_plans_subject" ON "syllabus_plans" ("subject_id");
      CREATE INDEX IF NOT EXISTS "idx_syllabus_plans_teacher" ON "syllabus_plans" ("teacher_id");

      CREATE INDEX IF NOT EXISTS "idx_lesson_plans_inst" ON "lesson_plans" ("institute_id");
      CREATE INDEX IF NOT EXISTS "idx_lesson_plans_teacher" ON "lesson_plans" ("teacher_id");
      CREATE INDEX IF NOT EXISTS "idx_lesson_plans_date" ON "lesson_plans" ("date");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "lesson_templates";
      DROP TABLE IF EXISTS "lesson_completions";
      DROP TABLE IF EXISTS "lesson_plans";
      DROP TABLE IF EXISTS "syllabus_plans";
    `);
  }
}
