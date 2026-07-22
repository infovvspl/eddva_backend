const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const insts = [
      { id: 'e9f3592d-851a-43be-9361-574e57722703', name: 'Central Public Academy' },
      { id: 'c259cd4e-b018-45e2-8e46-52a497ca49a1', name: "NAVAL'S NATIONAL ACADEMY" }
    ];

    for (const inst of insts) {
      const countRes = await client.query("SELECT COUNT(*) FROM subjects WHERE institute_id = $1", [inst.id]);
      console.log(`Institute: ${inst.name} has ${countRes.rows[0].count} subjects in total`);
      
      const detailsRes = await client.query("SELECT id, name, class_id, section_id FROM subjects WHERE institute_id = $1 ORDER BY name ASC", [inst.id]);
      console.log(`Subjects list (ordered by name):`);
      console.log(detailsRes.rows.map(r => `${r.name} (class_id: ${r.class_id}, section_id: ${r.section_id})`));
    }

  } catch (err) {
    console.error("Error inspecting database:", err);
  } finally {
    await client.end();
  }
}

run();
