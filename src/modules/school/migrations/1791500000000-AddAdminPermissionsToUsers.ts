import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminPermissionsToUsers1791500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_primary_admin BOOLEAN NOT NULL DEFAULT FALSE;`);
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions JSONB NULL;`);

    // Backfill: the earliest-created INSTITUTE_ADMIN per institute becomes the
    // primary admin — matches the ordering heuristic school-institute.service.ts
    // already uses informally for display/lookup, now made an explicit, durable flag.
    await queryRunner.query(`
      UPDATE users u
      SET is_primary_admin = TRUE
      FROM (
        SELECT DISTINCT ON (institute_id) id
        FROM users
        WHERE role = 'INSTITUTE_ADMIN' AND institute_id IS NOT NULL
        ORDER BY institute_id, created_at ASC
      ) first_admin
      WHERE u.id = first_admin.id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS admin_permissions;`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS is_primary_admin;`);
  }
}
