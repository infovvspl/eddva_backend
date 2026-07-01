const { Client } = require('pg');

async function run() {
  const schoolClient = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  const coachingClient = new Client({
    connectionString: 'postgres://postgres.utiqzdnyrrprcdghqkgv:Subham%40123%40@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await schoolClient.connect();
    const res = await schoolClient.query(`
      SELECT id, title, type, description 
      FROM study_materials 
      WHERE description LIKE '%real roots%' OR description LIKE '%discriminant%' OR description LIKE '%For no real roots%'
      LIMIT 1
    `);
    if (res.rows.length > 0) {
      console.log("School DB match:", res.rows[0].title);
      console.log(res.rows[0].description);
      return;
    }
  } catch (err) {
    console.error("School DB error:", err);
  } finally {
    await schoolClient.end();
  }

  try {
    await coachingClient.connect();
    const res = await coachingClient.query(`
      SELECT id, title, type, description 
      FROM topic_resources 
      WHERE description LIKE '%real roots%' OR description LIKE '%discriminant%' OR description LIKE '%For no real roots%'
      LIMIT 1
    `);
    if (res.rows.length > 0) {
      console.log("Coaching DB match:", res.rows[0].title);
      console.log(res.rows[0].description);
    }
  } catch (err) {
    console.error("Coaching DB error:", err);
  } finally {
    await coachingClient.end();
  }
}

run();
