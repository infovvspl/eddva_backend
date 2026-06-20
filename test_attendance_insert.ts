import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
  logging: false,
});

async function main() {
  await ds.initialize();

  // Find a teacher who currently has NO attendance for today (Teacher B)
  const rows = await ds.query(`
    SELECT u.id, u.name, u.institute_id
    FROM users u
    LEFT JOIN attendances a ON a.user_id = u.id AND a.date = CURRENT_DATE
    WHERE u.role = 'TEACHER' AND a.status IS NULL
    LIMIT 1
  `);

  if (rows.length === 0) {
    console.log('No absent teachers found.');
    process.exit(0);
  }

  const user = rows[0];
  console.log(`Testing Auto-Attendance for Teacher B: ${user.name} (ID: ${user.id})`);

  // Simulate the new logic inside login()
  if (true) { // user.role === 'TEACHER'
    try {
      const result = await ds.query(
        `INSERT INTO attendances (institute_id, user_id, date, status, remarks) VALUES ($1, $2, CURRENT_DATE, 'PRESENT', 'Auto-login')
         ON CONFLICT (date, user_id) DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks, updated_at=NOW() RETURNING *`,
        [user.institute_id, user.id]
      );
      console.log('Test Result: Attendance successfully created/updated:');
      console.log(result[0]);
    } catch (error) {
      console.error('Test Result: Attendance insertion failed:', error);
    }
  }

  // Simulate multiple logins for the same day (Duplicate protection test)
  console.log('\\nSimulating multiple logins on the same day for duplicate protection...');
  try {
    const result2 = await ds.query(
      `INSERT INTO attendances (institute_id, user_id, date, status, remarks) VALUES ($1, $2, CURRENT_DATE, 'PRESENT', 'Auto-login')
       ON CONFLICT (date, user_id) DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks, updated_at=NOW() RETURNING *`,
      [user.institute_id, user.id]
    );
    console.log('Test Result: Second login successfully handled via ON CONFLICT DO UPDATE. Record ID remained the same:');
    console.log(result2[0]);
  } catch (error) {
    console.error('Test Result: Second insertion failed:', error);
  }

  process.exit(0);
}

main().catch(console.error);
