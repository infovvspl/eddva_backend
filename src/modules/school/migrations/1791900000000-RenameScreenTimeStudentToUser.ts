import { MigrationInterface, QueryRunner } from 'typeorm';

// Screen-time tracking widened from students-only to every school role
// (teacher, parent, institute admin, staff) right after the table was first
// created — renaming before anyone else has pulled/relied on the old name.
export class RenameScreenTimeStudentToUser1791900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE school_screen_time_daily RENAME COLUMN student_user_id TO user_id;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE school_screen_time_daily RENAME COLUMN user_id TO student_user_id;`);
  }
}
