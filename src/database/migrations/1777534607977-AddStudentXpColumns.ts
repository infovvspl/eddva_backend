import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStudentXpColumns1777534607977 implements MigrationInterface {
  name = 'AddStudentXpColumns1777534607977';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS leaderboard_xp_total INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS leaderboard_xp_cycle INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS mock_xp_total INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS current_level INT NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      UPDATE students
      SET leaderboard_xp_total = COALESCE(NULLIF(leaderboard_xp_total, 0), xp_total, 0),
          leaderboard_xp_cycle = COALESCE(NULLIF(leaderboard_xp_cycle, 0), xp_total, 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE students
      DROP COLUMN IF EXISTS current_level,
      DROP COLUMN IF EXISTS mock_xp_total,
      DROP COLUMN IF EXISTS leaderboard_xp_cycle,
      DROP COLUMN IF EXISTS leaderboard_xp_total
    `);
  }
}
