const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // Count students
    const studentCount = await client.query("SELECT COUNT(*)::int AS count FROM students");
    console.log("Students Count:", studentCount.rows[0].count);

    // List some students
    const students = await client.query("SELECT s.id, s.user_id, u.full_name, u.email FROM students s JOIN users u ON u.id = s.user_id LIMIT 5");
    console.log("Some Students:", students.rows);

    // Count enrollments
    const enrollmentsCount = await client.query("SELECT COUNT(*)::int AS count FROM enrollments");
    console.log("Enrollments Count:", enrollmentsCount.rows[0].count);

    // List some enrollments
    const enrollments = await client.query("SELECT * FROM enrollments LIMIT 5");
    console.log("Some Enrollments:", enrollments.rows);

    // If there are enrollments, let's see why the JOIN in getCourseEnrollments might fail
    if (enrollmentsCount.rows[0].count > 0) {
      console.log("\nTesting getCourseEnrollments query joins...");
      // Let's check which joins fail
      const testJoin = await client.query(`
        SELECT 
          (SELECT COUNT(*)::int FROM enrollments) AS total_e,
          (SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id) AS with_s,
          (SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id) AS with_su,
          (SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id JOIN batches b ON b.id = e.batch_id) AS with_sub,
          (SELECT COUNT(*)::int FROM enrollments e JOIN students s ON s.id = e.student_id JOIN users u ON u.id = s.user_id JOIN batches b ON b.id = e.batch_id JOIN tenants t ON t.id = e.tenant_id) AS with_subt
      `);
      console.log("Join test result:", testJoin.rows[0]);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
