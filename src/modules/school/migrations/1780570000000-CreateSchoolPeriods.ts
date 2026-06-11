import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSchoolPeriods1780570000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create school_periods table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS school_periods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
        academic_year_id VARCHAR,
        sequence_no INTEGER NOT NULL,
        period_name VARCHAR NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        period_type VARCHAR NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Add period_id to timetables table
    await queryRunner.query(`
      ALTER TABLE timetables 
      ADD COLUMN IF NOT EXISTS period_id UUID REFERENCES school_periods(id) ON DELETE SET NULL;
    `);

    // 3. Automatically create default periods for existing schools/institutes
    const institutes = await queryRunner.query(`SELECT id FROM institutes`);
    const defaultPeriods = [
      { name: 'Period 1', start: '08:00:00', end: '08:45:00' },
      { name: 'Period 2', start: '08:45:00', end: '09:30:00' },
      { name: 'Period 3', start: '09:30:00', end: '10:15:00' },
      { name: 'Period 4', start: '10:15:00', end: '11:00:00' },
      { name: 'Period 5', start: '11:00:00', end: '11:45:00' },
      { name: 'Period 6', start: '11:45:00', end: '12:30:00' },
      { name: 'Period 7', start: '12:30:00', end: '13:15:00' },
      { name: 'Period 8', start: '13:15:00', end: '14:00:00' },
    ];

    for (const inst of institutes) {
      const schoolId = inst.id;
      // Check if periods already exist for this school to avoid duplicates
      const existing = await queryRunner.query(
        `SELECT count(*)::int as count FROM school_periods WHERE school_id = $1`,
        [schoolId]
      );
      if (existing[0].count === 0) {
        for (let i = 0; i < defaultPeriods.length; i++) {
          const p = defaultPeriods[i];
          await queryRunner.query(
            `INSERT INTO school_periods (school_id, sequence_no, period_name, start_time, end_time, period_type) 
             VALUES ($1, $2, $3, $4, $5, 'Academic')`,
            [schoolId, i + 1, p.name, p.start, p.end]
          );
        }
      }
    }

    // 4. Map existing timetables to the newly created default periods
    await queryRunner.query(`
      UPDATE timetables 
      SET period_id = sp.id 
      FROM school_periods sp 
      WHERE timetables.institute_id = sp.school_id 
        AND timetables.period_number = sp.sequence_no;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE timetables DROP COLUMN IF EXISTS period_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS school_periods`);
  }
}
