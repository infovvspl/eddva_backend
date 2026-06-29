const { Client } = require('pg');

const dbUrl = "postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:5432/postgres";

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  
  const tenantId = '911fa646-fc0b-4421-b44b-c613cb44e10c';
  
  try {
    const subjects = await client.query("SELECT id, name FROM subjects WHERE tenant_id = $1;", [tenantId]);
    console.log("Subjects:", subjects.rows);

    const chapters = await client.query("SELECT id, name, subject_id FROM chapters WHERE subject_id = ANY($1);", [subjects.rows.map(s => s.id)]);
    console.log("Chapters count:", chapters.rows.length);

    // Let's check attempts under this tenant
    const attempts = await client.query("SELECT COUNT(*) FROM question_attempts WHERE tenant_id = $1;", [tenantId]);
    console.log("Question attempts in this tenant:", attempts.rows[0].count);

    // Let's print all students in this tenant
    const students = await client.query("SELECT s.id, u.full_name FROM students s JOIN users u ON u.id = s.user_id WHERE s.tenant_id = $1;", [tenantId]);
    console.log("Students in this tenant:", students.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
