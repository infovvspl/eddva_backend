import { MigrationInterface, QueryRunner } from 'typeorm';

export class BatchSubjectTeachers1700000000002 implements MigrationInterface {
  name = 'BatchSubjectTeachers1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE batch_subject_teachers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id VARCHAR NOT NULL,
        batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_name VARCHAR NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT UQ_batch_subject UNIQUE (batch_id, subject_name)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_batch_subject_teachers_batch ON batch_subject_teachers(batch_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IDX_batch_subject_teachers_teacher ON batch_subject_teachers(teacher_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS batch_subject_teachers`);
  }
}
