const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const studentId = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54'; // Pratap Das

  const res = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE LOWER(ar.status) IN ('present', 'late'))::int AS present,
      COUNT(*) FILTER (WHERE LOWER(ar.status)='absent')::int AS absent,
      COUNT(*) FILTER (WHERE LOWER(ar.status)='leave')::int AS leave,
      COUNT(*)::int AS total
    FROM attendance_records ar
    WHERE ar.student_id = $1
  `, [studentId]);
  
  console.log("Query result for student", studentId, ":", res.rows[0]);

  // Check the frontend response format. Let's make an API call to localhost:5000/school/students/dashboard
  // Wait, I don't have the JWT token.
  await client.end();
}

run().catch(console.error);
