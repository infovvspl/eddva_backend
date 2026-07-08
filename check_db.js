const { Client } = require('pg');
(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const res = await client.query(`
        INSERT INTO class_recordings (
          institute_id, class_id, section_id, subject_id, teacher_user_id,
          title, description, video_url, thumbnail_url,
          source, recorded_date, duration, transcript_status, language, created_at
        )
        SELECT
          l.institute_id, l.class_id, l.section_id, l.subject_id, l.teacher_id,
          l.title, l.description, l.recording_url, l.thumbnail_url,
          'live_stream', l.ended_at, l.recording_duration_seconds::varchar, 'pending', 'en', l.ended_at
        FROM school_live_lectures l
        WHERE l.status IN ('PROCESSED', 'ENDED')
          AND l.recording_url IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM class_recordings cr
            WHERE cr.video_url = l.recording_url
          )
        RETURNING id;
  `);
  console.log('Migrated IDs:', res.rows.map(r => r.id));
  await client.end();
})().catch(console.error);
