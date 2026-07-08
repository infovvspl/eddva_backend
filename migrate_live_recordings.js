const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });
  await client.connect();
  try {
    const res = await client.query(`
      INSERT INTO class_recordings (
        institute_id, class_id, section_id, subject_id, teacher_user_id,
        title, description, video_url, thumbnail_url,
        source, recorded_date, duration, transcript_status, language, created_at
      )
      SELECT
        l.institute_id, l.class_id, l.section_id, l.subject_id, l.teacher_user_id,
        l.title, l.description, l.recording_url, l.thumbnail_url,
        'live_stream', l.ended_at, l.recording_duration_seconds::varchar, 'pending', 'en', l.ended_at
      FROM school_live_lectures l
      WHERE l.status = 'PROCESSED'
        AND l.recording_url IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM class_recordings cr
          WHERE cr.video_url = l.recording_url
        )
      RETURNING id;
    `);
    console.log('Migrated rows:', res.rowCount);
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
})().catch(console.error);
