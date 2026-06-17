const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to School DB");

    const sql = `
      SELECT s.id, s.name,
             COALESCE((
               SELECT json_agg(
                 json_build_object(
                   'id', ch.id,
                   'name', ch.name,
                   'sortOrder', ch.sort_order,
                   'subjectId', ch.subject_id
                 )
                 ORDER BY ch.sort_order, ch.name
               )
               FROM chapters ch
               WHERE ch.subject_id::text = s.id::text
             ), '[]'::json) AS chapters
      FROM subjects s
    `;

    const res = await client.query(sql);
    console.log("Subjects with Chapters:");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
