const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // 1. Run the platform stats student query
    const statsQuery = `
      SELECT COUNT(DISTINCT s.id)::int AS count
      FROM students s
      LEFT JOIN tenants t ON t.id = s.tenant_id
      WHERE s.deleted_at IS NULL AND (t.type != 'platform' OR t.id IS NULL)
    `;
    const statsResult = await client.query(statsQuery);
    console.log("Stats query returned:", statsResult.rows[0].count);

    // Let's see the details of the students that are in stats query
    const statsStudents = await client.query(`
      SELECT s.id, s.tenant_id, t.name AS tenant_name, t.type AS tenant_type
      FROM students s
      LEFT JOIN tenants t ON t.id = s.tenant_id
      WHERE s.deleted_at IS NULL AND (t.type != 'platform' OR t.id IS NULL)
    `);
    console.log("Stats students details (Count:", statsStudents.rowCount, "):");
    console.log(statsStudents.rows);

    // 2. Run the enrollments query to find out how many unique students are returned
    const enrollmentsUniqueQuery = `
      SELECT s.id, u.full_name, t.name AS tenant_name
      FROM students s
      JOIN users      u ON u.id       = s.user_id AND u.deleted_at IS NULL
      JOIN enrollments e ON e.student_id = s.id AND e.deleted_at IS NULL
      JOIN batches    b ON b.id       = e.batch_id AND b.deleted_at IS NULL
      JOIN tenants    t ON t.id       = e.tenant_id AND t.deleted_at IS NULL
      WHERE s.deleted_at IS NULL
      GROUP BY s.id, u.id, t.id
    `;
    const enrollmentsResult = await client.query(enrollmentsUniqueQuery);
    console.log("\nUnique students in enrollments query (Count:", enrollmentsResult.rowCount, "):");
    console.log(enrollmentsResult.rows);

    // Let's check which batches/courses are joined
    console.log("\nBatches currently returned in enrollments query:");
    const batchesResult = await client.query(`
      SELECT DISTINCT b.id, b.name, b.deleted_at
      FROM enrollments e
      JOIN batches b ON b.id = e.batch_id
      WHERE e.deleted_at IS NULL
    `);
    console.log(batchesResult.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
