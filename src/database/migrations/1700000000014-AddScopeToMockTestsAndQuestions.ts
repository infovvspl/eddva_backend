import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScopeToMockTestsAndQuestions1700000000014 implements MigrationInterface {
    name = 'AddScopeToMockTestsAndQuestions1700000000014';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // ── Mock tests: scope enum + subject_id + chapter_id ──────────────────
        await queryRunner.query(`
            DO $$ BEGIN
                CREATE TYPE "public"."mock_test_scope_enum" AS ENUM('batch', 'subject', 'chapter', 'topic');
            EXCEPTION WHEN duplicate_object THEN null; END $$
        `);

        // Add SUBJECT_TEST and TOPIC_TEST to existing mock_test_type_enum
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TYPE "public"."mock_tests_type_enum" ADD VALUE IF NOT EXISTS 'subject_test';
                ALTER TYPE "public"."mock_tests_type_enum" ADD VALUE IF NOT EXISTS 'topic_test';
            EXCEPTION WHEN others THEN null; END $$
        `);

        await queryRunner.query(`
            ALTER TABLE "mock_tests"
                ADD COLUMN IF NOT EXISTS "scope"      "public"."mock_test_scope_enum" NOT NULL DEFAULT 'batch',
                ADD COLUMN IF NOT EXISTS "subject_id" UUID,
                ADD COLUMN IF NOT EXISTS "chapter_id" UUID
        `);

        await queryRunner.query(`
            ALTER TABLE "mock_tests"
                ADD CONSTRAINT "FK_mock_tests_subject"
                FOREIGN KEY ("subject_id") REFERENCES "subjects"("id")
                ON DELETE SET NULL ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "mock_tests"
                ADD CONSTRAINT "FK_mock_tests_chapter"
                FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id")
                ON DELETE SET NULL ON UPDATE NO ACTION
        `);

        // ── Questions: subject_id + chapter_id ────────────────────────────────
        await queryRunner.query(`
            ALTER TABLE "questions"
                ADD COLUMN IF NOT EXISTS "subject_id" UUID,
                ADD COLUMN IF NOT EXISTS "chapter_id" UUID
        `);

        await queryRunner.query(`
            ALTER TABLE "questions"
                ADD CONSTRAINT "FK_questions_subject"
                FOREIGN KEY ("subject_id") REFERENCES "subjects"("id")
                ON DELETE SET NULL ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "questions"
                ADD CONSTRAINT "FK_questions_chapter"
                FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id")
                ON DELETE SET NULL ON UPDATE NO ACTION
        `);

        // Make topic_id nullable on questions (PYQs may be chapter/subject-scoped)
        await queryRunner.query(`
            ALTER TABLE "questions" ALTER COLUMN "topic_id" DROP NOT NULL
        `);

        // Indexes for fast scope-based lookups
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_mock_tests_scope"      ON "mock_tests" ("scope")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_mock_tests_subject_id" ON "mock_tests" ("subject_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_mock_tests_chapter_id" ON "mock_tests" ("chapter_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_questions_subject_id"  ON "questions"  ("subject_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_questions_chapter_id"  ON "questions"  ("chapter_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_questions_chapter_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_questions_subject_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mock_tests_chapter_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mock_tests_subject_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mock_tests_scope"`);
        await queryRunner.query(`ALTER TABLE "questions" ALTER COLUMN "topic_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "FK_questions_chapter"`);
        await queryRunner.query(`ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "FK_questions_subject"`);
        await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN IF EXISTS "chapter_id"`);
        await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN IF EXISTS "subject_id"`);
        await queryRunner.query(`ALTER TABLE "mock_tests" DROP CONSTRAINT IF EXISTS "FK_mock_tests_chapter"`);
        await queryRunner.query(`ALTER TABLE "mock_tests" DROP CONSTRAINT IF EXISTS "FK_mock_tests_subject"`);
        await queryRunner.query(`ALTER TABLE "mock_tests" DROP COLUMN IF EXISTS "chapter_id"`);
        await queryRunner.query(`ALTER TABLE "mock_tests" DROP COLUMN IF EXISTS "subject_id"`);
        await queryRunner.query(`ALTER TABLE "mock_tests" DROP COLUMN IF EXISTS "scope"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."mock_test_scope_enum"`);
    }
}
