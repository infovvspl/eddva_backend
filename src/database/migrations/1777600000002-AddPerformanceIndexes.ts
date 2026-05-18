import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1777600000002 implements MigrationInterface {
  name = 'AddPerformanceIndexes1777600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for enrollment lookups by batch + student (used in every
    // content / live-class query that checks student access to a batch)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_enrollments_batch_student"
       ON "enrollments" ("batch_id", "student_id")`,
    );

    // Lectures filtered by batch + status (teacher schedule views, student feed)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_lectures_batch_status"
       ON "lectures" ("batch_id", "status")`,
    );

    // Lectures filtered by tenant + teacher (teacher dashboard, live-class guard)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_lectures_tenant_teacher"
       ON "lectures" ("tenant_id", "teacher_id")`,
    );

    // Test-session lookups by student + status (assessment listing, dashboard count)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_test_sessions_student_status"
       ON "test_sessions" ("student_id", "status")`,
    );

    // Live-attendance join/leave lookups (WebSocket join recording)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_live_attendances_session_student"
       ON "live_attendances" ("live_session_id", "student_id")`,
    );

    // Notification inbox queries (user + tenant, the most common filter)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_notifications_user_tenant_status"
       ON "notifications" ("user_id", "tenant_id", "status")`,
    );

    // Enrollments by tenant + status (leaderboard, batch-wide notification blast)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_enrollments_tenant_status"
       ON "enrollments" ("tenant_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_enrollments_tenant_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_notifications_user_tenant_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_live_attendances_session_student"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_test_sessions_student_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_lectures_tenant_teacher"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_lectures_batch_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_enrollments_batch_student"`);
  }
}