const { Client } = require('pg');

async function auditDeleteDependencies() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const fks = await client.query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS referenced_table_name,
        tc.constraint_name,
        rc.delete_rule
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints AS rc
          ON tc.constraint_name = rc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND ccu.table_name IN ('users', 'students')
      ORDER BY ccu.table_name, tc.table_name;
    `);

    console.log(JSON.stringify(fks.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

auditDeleteDependencies();
