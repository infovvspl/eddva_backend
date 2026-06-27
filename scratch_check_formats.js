const { Client } = require('pg');

async function run() {
  const coachingClient = new Client({
    connectionString: 'postgres://postgres.utiqzdnyrrprcdghqkgv:Subham%40123%40@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await coachingClient.connect();
    console.log("Connected to Coaching DB");

    const typesRes = await coachingClient.query(`SELECT DISTINCT type FROM topic_resources`);
    console.log("Coaching Resource Types:", typesRes.rows.map(r => r.type));

    // Let's query based on the actual enum casing (usually uppercase for NestJS enums)
    const coachingRes = await coachingClient.query(`
      (SELECT 'coaching_dpp' as source, type, title, description FROM topic_resources WHERE type::text ILIKE 'dpp' AND description IS NOT NULL LIMIT 1)
      UNION ALL
      (SELECT 'coaching_pyq' as source, type, title, description FROM topic_resources WHERE type::text ILIKE 'pyq' AND description IS NOT NULL LIMIT 1)
      UNION ALL
      (SELECT 'coaching_faq' as source, type, title, description FROM topic_resources WHERE type::text ILIKE 'faq' AND description IS NOT NULL LIMIT 1)
    `);

    for (const row of coachingRes.rows) {
      console.log(`\n=================== ${row.source.toUpperCase()} ===================`);
      console.log("Title:", row.title);
      console.log("Type:", row.type);
      console.log("Description snippet:\n", row.description ? row.description.substring(0, 1000) : "NULL");
    }
  } catch (err) {
    console.error("Coaching DB query failed:", err);
  } finally {
    await coachingClient.end();
  }
}

run();
