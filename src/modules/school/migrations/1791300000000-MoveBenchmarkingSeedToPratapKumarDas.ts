import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The benchmarking seed from 1791200000000 landed on pratap.das@gmail.com
 * because the requested address was mistyped. Move those tagged rows to the
 * intended teacher (pratapdas78488@gmail.com). No-op if that teacher has no
 * teachers row or the tagged rows are already on them.
 */
const TAG = 'seed:teacher-benchmarking%';
const TARGET = 'pratapdas78488@gmail.com';
const PREVIOUS = 'pratap.das@gmail.com';

export class MoveBenchmarkingSeedToPratapKumarDas1791300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const target = await queryRunner.query(
      `SELECT u.id::text AS id FROM users u JOIN teachers t ON t.user_id = u.id WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
      [TARGET],
    );
    if (!target.length) return;
    await queryRunner.query(
      `UPDATE class_recordings SET teacher_user_id = $1::uuid WHERE video_key LIKE $2 AND teacher_user_id::text <> $1`,
      [target[0].id, TAG],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const prev = await queryRunner.query(
      `SELECT u.id::text AS id FROM users u WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
      [PREVIOUS],
    );
    if (!prev.length) return;
    await queryRunner.query(`UPDATE class_recordings SET teacher_user_id = $1::uuid WHERE video_key LIKE $2`, [prev[0].id, TAG]);
  }
}
