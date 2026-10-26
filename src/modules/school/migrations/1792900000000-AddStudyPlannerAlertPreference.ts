import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A notification preference for the weekly AI Study Planner alerts (students
 * who stopped, are barely engaged, or study without improving), on by
 * default like the other alert types.
 */
export class AddStudyPlannerAlertPreference1792900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.notification_preferences') IS NOT NULL THEN
          ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS study_planner_alerts BOOLEAN NOT NULL DEFAULT TRUE;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.notification_preferences') IS NOT NULL THEN
          ALTER TABLE notification_preferences DROP COLUMN IF EXISTS study_planner_alerts;
        END IF;
      END $$;
    `);
  }
}
