import { MigrationInterface, QueryRunner } from 'typeorm';

export class VerifyExistingPYQs1700000000007 implements MigrationInterface {
  name = 'VerifyExistingPYQs1700000000007';

  async up(qr: QueryRunner): Promise<void> {
    // Mark all existing PYQ questions as verified + global
    // (migration 006 added the columns but forgot to set them for existing rows)
    await qr.query(`
      UPDATE questions
         SET is_verified = true,
             is_global   = true,
             pyq_exam    = COALESCE(pyq_exam, pyq_paper)
       WHERE source = 'pyq'
         AND is_verified = false
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    // Intentionally a no-op — we can't know which were manually verified vs auto-verified
  }
}
