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
  
  const teachers = await ds.query(`
    SELECT u.id, u.name, u.email, u.is_active, u.institute_id, a.status, a.date, a.institute_id as att_inst_id
    FROM users u
    LEFT JOIN attendances a ON a.user_id = u.id AND a.date = CURRENT_DATE
    WHERE u.role = 'TEACHER'
  `);

  console.log('Teachers and their attendance today:');
  console.table(teachers);

  // Check structure of attendances table to see what the PK/Unique constraints are
  const uniqueConstraints = await ds.query(`
    SELECT conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conrelid = 'attendances'::regclass;
  `);
  console.log('Unique Constraints on attendances:', uniqueConstraints);

  process.exit(0);
}

main().catch(console.error);
