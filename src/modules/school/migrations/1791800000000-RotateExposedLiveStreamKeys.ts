import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives every scheduled school live class a new stream key.
 *
 * Before the playback-ID fix (Live Class QA report, B-02), GET
 * /school/live/lectures and /stream-url returned each class's stream key to
 * students, and anyone holding it can publish into the class. Keys that were
 * readable then must not keep working. Only SCHEDULED classes are rotated:
 * a LIVE class would lose its running stream, and ENDED / PROCESSED /
 * CANCELLED classes can no longer be published to (validateStream refuses
 * them). playback_url embeds the key, so it is rewritten too. Teachers get
 * the new key from Stream Info as usual.
 *
 * Runs once. Skips quietly where the table does not exist yet (it is created
 * by SchoolLiveService on start).
 */
export class RotateExposedLiveStreamKeys1791800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.query(`SELECT to_regclass('public.school_live_lectures') AS t`);
    if (!exists?.[0]?.t) return;
    await queryRunner.query(`
      UPDATE school_live_lectures l
         SET stream_key = n.key,
             playback_url = CASE WHEN l.playback_url IS NULL THEN NULL
                                 ELSE replace(l.playback_url, l.stream_key, n.key) END
        FROM (
          SELECT id, md5(random()::text || id::text || clock_timestamp()::text) AS key
            FROM school_live_lectures WHERE status = 'SCHEDULED'
        ) n
       WHERE l.id = n.id
    `);
  }

  public async down(): Promise<void> {
    // The old keys are deliberately not restorable.
  }
}
