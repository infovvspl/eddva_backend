const { Client } = require('pg');

async function testApiPayload() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // Emulate school-attendance.service.ts get() method
    const sql = `
      SELECT 
        a.*,
        u.name AS user_name,
        u.email,
        u.role,
        s.id AS student_profile_id,
        sec.id AS section_id,
        sec.name AS section_name,
        c.id AS class_id,
        c.name AS class_name
      FROM attendances a 
      JOIN users u ON a.user_id = u.id 
      LEFT JOIN students s ON s.user_id = u.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN classes c ON sec.class_id = c.id
      ORDER BY a.date DESC
      LIMIT 10 OFFSET 0
    `;
    
    const rows = await client.query(sql);

    const mapped = rows.rows.map(r => ({
      id: r.id,
      date: r.date,
      status: r.status,
      remarks: r.remarks,
      user: {
        id: r.user_id,
        name: r.user_name,
      }
    }));

    console.log('--- RAW JSON RESPONSE SENT TO FRONTEND ---');
    const jsonStr = JSON.stringify(mapped, null, 2);
    console.log(jsonStr);
    
    console.log('--- FRONTEND DATE PARSING EMULATION ---');
    
    function parseRecordDate(v) {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    function localDateKey(d) {
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    const payload = JSON.parse(jsonStr);
    payload.forEach(record => {
      console.log(`\nRecord for ${record.user.name}:`);
      console.log(`1. record.date from JSON: "${record.date}"`);
      const d = parseRecordDate(record.date);
      console.log(`2. parseRecordDate(record.date): ${d.toString()}`);
      const key = localDateKey(d);
      console.log(`3. localDateKey(parseRecordDate(record.date)): "${key}"`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

testApiPayload();
