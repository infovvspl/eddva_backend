import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNationalityCountryToTeachers1780590000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teachers
      ADD COLUMN IF NOT EXISTS nationality VARCHAR(100),
      ADD COLUMN IF NOT EXISTS country VARCHAR(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teachers
      DROP COLUMN IF EXISTS nationality,
      DROP COLUMN IF EXISTS country
    `);
  }
}
