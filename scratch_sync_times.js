const { Client } = require('pg');

async function run() {
  const clientSchool = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientSchool.connect();
    
    // Perform update
    console.log("Updating timetable slots to match period times...");
    const updateRes = await clientSchool.query(`
      UPDATE timetables t
      SET
        start_time = substring(sp.start_time::text from 1 for 5),
        end_time = substring(sp.end_time::text from 1 for 5),
        period_number = sp.sequence_no
      FROM school_periods sp
      WHERE t.period_id = sp.id
        AND (
          t.start_time != substring(sp.start_time::text from 1 for 5)
          OR t.end_time != substring(sp.end_time::text from 1 for 5)
          OR t.period_number != sp.sequence_no
        )
      RETURNING t.id, t.start_time, t.end_time, t.period_number, sp.period_name
    `);
    
    console.log("Updated rows count:", updateRes.rows.length);
    console.log("Updated rows details:\n", updateRes.rows);

    await clientSchool.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
