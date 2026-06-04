const { Client } = require('pg');

async function fixDb() {
  const client = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log("Connected to DB.");
    
    // Drop the faulty constraint if it exists
    try {
      await client.query('ALTER TABLE students DROP CONSTRAINT "FK_293833a3218a32c7a2cda3693f3"');
      console.log("Dropped wrong constraint FK_293833a3218a32c7a2cda3693f3.");
    } catch (e) {
      console.log("Constraint might not exist or already dropped:", e.message);
    }
    
    // Add the correct constraint
    try {
      await client.query('ALTER TABLE students ADD CONSTRAINT "fk_students_institute_id" FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE');
      console.log("Added correct constraint.");
    } catch (e) {
      console.log("Constraint fk_students_institute_id might already exist:", e.message);
    }

    // Clean up orphaned users
    const result = await client.query(`
      DELETE FROM users 
      WHERE role = 'STUDENT' 
      AND id NOT IN (SELECT user_id FROM students)
      RETURNING id, email
    `);
    console.log("Deleted orphaned users:", result.rows);
    
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}
fixDb();
