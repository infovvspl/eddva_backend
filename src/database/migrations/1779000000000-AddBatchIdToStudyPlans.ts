import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBatchIdToStudyPlans1779000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add batch_id column
    await queryRunner.query(`
      ALTER TABLE study_plans
      ADD COLUMN IF NOT EXISTS batch_id UUID NULL
    `);

    // Drop old unique constraint on student_id alone
    await queryRunner.query(`
      ALTER TABLE study_plans
      DROP CONSTRAINT IF EXISTS "UQ_study_plans_student_id"
    `);
    // Also try the TypeORM-generated constraint name
    await queryRunner.query(`
      DO $$
      DECLARE
        cname text;
      BEGIN
        SELECT conname INTO cname
        FROM pg_constraint
        WHERE conrelid = 'study_plans'::regclass
          AND contype = 'u'
          AND array_length(conkey, 1) = 1
          AND conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'study_plans'::regclass AND attname = 'student_id');
        IF cname IS NOT NULL THEN
          EXECUTE 'ALTER TABLE study_plans DROP CONSTRAINT ' || quote_ident(cname);
        END IF;
      END $$;
    `);

    // Create partial unique index: one plan per student when batch_id IS NULL (global plan)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS study_plans_student_global_uniq
        ON study_plans (student_id)
        WHERE batch_id IS NULL AND deleted_at IS NULL
    `);

    // Create partial unique index: one plan per (student, batch) when batch_id IS NOT NULL
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS study_plans_student_batch_uniq
        ON study_plans (student_id, batch_id)
        WHERE batch_id IS NOT NULL AND deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS study_plans_student_batch_uniq`);
    await queryRunner.query(`DROP INDEX IF EXISTS study_plans_student_global_uniq`);
    await queryRunner.query(`
      ALTER TABLE study_plans
      ADD CONSTRAINT "UQ_study_plans_student_id" UNIQUE (student_id)
    `);
    await queryRunner.query(`
      ALTER TABLE study_plans
      DROP COLUMN IF EXISTS batch_id
    `);
  }
}
