const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });
client.connect().then(async () => {
  const res = await client.query('SELECT institute_id, parent_email, father_name, mother_name FROM students WHERE parent_email = $1 LIMIT 1', ['subhamm084@gmail.com']);
  if (res.rows.length > 0) {
    const student = res.rows[0];
    const parentName = student.father_name || student.mother_name || 'Parent';
    const hash = '$2a$10$SXRj8LsgbosVtQ0rTFch..ZxowDPFTxihsZyzwY9k46JSzJm6v3wi';
    const existing = await client.query('SELECT id FROM users WHERE email = $1', ['subhamm084@gmail.com']);
    if (existing.rows.length > 0) {
      await client.query('UPDATE users SET password = $1 WHERE email = $2', [hash, 'subhamm084@gmail.com']);
      console.log('Updated existing parent user password.');
    } else {
      await client.query('INSERT INTO users (institute_id, name, email, password, role, is_active) VALUES ($1, $2, $3, $4, $5, true)', [student.institute_id, parentName, 'subhamm084@gmail.com', hash, 'PARENT']);
      console.log('Inserted new parent user.');
    }
  } else {
    console.log('No student found with that parent_email.');
  }
  await client.end();
}).catch(console.error);
