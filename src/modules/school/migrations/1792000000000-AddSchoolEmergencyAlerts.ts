import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchoolEmergencyAlerts1792000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS school_emergency_alerts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        student_user_id uuid NOT NULL,
        institute_id uuid,
        sender_user_id uuid NOT NULL,
        sender_name varchar,
        sender_role varchar,
        message text NOT NULL,
        sms_sent boolean,
        sms_error text,
        email_sent boolean,
        email_error text,
        status varchar NOT NULL DEFAULT 'ACTIVE',
        resolved_by uuid,
        resolved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_school_emergency_alerts_student_status
        ON school_emergency_alerts (student_user_id, status);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_school_emergency_alerts_institute_status
        ON school_emergency_alerts (institute_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS school_emergency_alerts;`);
  }
}
