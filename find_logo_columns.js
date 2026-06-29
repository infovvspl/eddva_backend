const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });

async function inspect(dbUrl, dbName) {
  if (!dbUrl) {
    console.log(`${dbName} is not defined`);
    return;
  }
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log(`\n--- Inspecting ${dbName} ---`);
    const res = await client.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND (column_name LIKE '%logo%' 
             OR column_name LIKE '%img%' 
             OR column_name LIKE '%image%' 
             OR column_name LIKE '%photo%' 
             OR column_name LIKE '%file%')
      ORDER BY table_name, column_name;
    `);
    
    for (const row of res.rows) {
      console.log(`Table: "${row.table_name}" | Column: "${row.column_name}" | Type: ${row.data_type}`);
      // Let's query if there is any non-null data in this column
      try {
        const dataRes = await client.query(`
          SELECT "${row.column_name}" AS val 
          FROM "${row.table_name}" 
          WHERE "${row.column_name}" IS NOT NULL 
          LIMIT 5
        `);
        if (dataRes.rows.length > 0) {
          console.log(`   Sample Data:`, dataRes.rows.map(r => r.val));
        } else {
          console.log(`   (All values are null)`);
        }
      } catch (err) {
        console.log(`   (Error querying data: ${err.message})`);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

async function main() {
  await inspect(process.env.SCHOOL_DB_URL, 'SCHOOL_DB');
  await inspect(process.env.COACHING_DB_URL, 'COACHING_DB');
}

main();
