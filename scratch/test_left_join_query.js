const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    const query = `
      SELECT
        s.id              AS student_id,
        u.full_name       AS student_name,
        u.email           AS student_email,
        u.phone_number    AS student_phone,
        s.care_of         AS care_of,
        s.city            AS city,
        s.state           AS state,
        s.pin_code        AS pin_code,
        t.id              AS tenant_id,
        t.name            AS institute_name,
        t.subdomain       AS institute_subdomain,
        MAX(e.enrolled_at) AS enrolled_at,
        JSON_AGG(JSON_BUILD_OBJECT(
          'id', e.id,
          'status', e.status,
          'enrolled_at', e.enrolled_at,
          'fee_paid', e.fee_paid,
          'batch_id', b.id,
          'batch_name', b.name,
          'exam_target', b.exam_target
        ))                AS enrollments
      FROM students s
      JOIN users      u ON u.id       = s.user_id AND u.deleted_at IS NULL
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.deleted_at IS NULL
      LEFT JOIN batches    b ON b.id       = e.batch_id AND b.deleted_at IS NULL
      LEFT JOIN tenants    t ON t.id       = COALESCE(e.tenant_id, s.tenant_id) AND t.deleted_at IS NULL
      WHERE s.deleted_at IS NULL
      GROUP BY s.id, u.id, t.id
      ORDER BY enrolled_at DESC NULLS LAST
    `;

    const res = await client.query(query);
    console.log("Count of students returned:", res.rowCount);
    console.log(res.rows.map(r => ({
      student_name: r.student_name,
      enrollments: (r.enrollments || []).filter(e => e.id !== null)
    })));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
