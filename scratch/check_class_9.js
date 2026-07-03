const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  const classes = await client.query("SELECT id, name, academic_year FROM classes WHERE name ILIKE '%Class-9%' OR name ILIKE '%Class 9%';");
  console.log('--- CLASSES ---');
  console.log(classes.rows);
  
  const sections = await client.query("SELECT id, name, class_id, academic_year FROM sections WHERE class_id IN (SELECT id FROM classes WHERE name ILIKE '%Class-9%' OR name ILIKE '%Class 9%');");
  console.log('--- SECTIONS ---');
  console.log(sections.rows);

  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
