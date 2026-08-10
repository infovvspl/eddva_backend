const { Client } = require('pg');

async function testStorageUsage() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to eddva_school");

    const sql = `
      SELECT
        i.id,
        i.name,
        i.status,
        COALESCE(SUM(sm.file_size_kb), 0)::bigint                                                         AS total_kb,
        COUNT(sm.id)::int                                                                                  AS file_count,
        COALESCE(SUM(CASE WHEN sm.type::text = 'ppt'   THEN sm.file_size_kb ELSE 0 END), 0)::bigint      AS ppt_kb,
        COALESCE(SUM(CASE WHEN sm.type::text = 'video' THEN sm.file_size_kb ELSE 0 END), 0)::bigint      AS video_kb,
        COALESCE(SUM(CASE WHEN sm.type::text NOT IN ('ppt','video') THEN sm.file_size_kb ELSE 0 END), 0)::bigint AS doc_kb,
        COUNT(CASE WHEN sm.type::text = 'ppt'   THEN 1 END)::int                                         AS ppt_count,
        COUNT(CASE WHEN sm.type::text = 'video' THEN 1 END)::int                                         AS video_count,
        COUNT(CASE WHEN sm.type::text NOT IN ('ppt','video') THEN 1 END)::int                            AS doc_count
      FROM institutes i
      LEFT JOIN study_materials sm ON sm.tenant_id::text = i.id::text
      GROUP BY i.id, i.name, i.status
      ORDER BY total_kb DESC
    `;

    const res = await client.query(sql);
    console.log("Storage usage query result count:", res.rows.length);
    console.log("Sample result row:", res.rows[0]);
  } catch (err) {
    console.error("Storage usage query failed:", err);
  } finally {
    await client.end();
  }
}

testStorageUsage();
