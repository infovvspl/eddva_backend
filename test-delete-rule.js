const { Client } = require('pg');

async function testDeleteRule() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const fks = await client.query(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        rc.delete_rule
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.referential_constraints AS rc
          ON tc.constraint_name = rc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_name IN ('notifications', 'students');
    `);

    for (const row of fks.rows) {
      console.log(`Table: ${row.table_name}, FK: ${row.constraint_name}, Delete Rule: ${row.delete_rule}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

testDeleteRule();
