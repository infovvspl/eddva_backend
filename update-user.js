const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'
});

async function update() {
  await client.connect();
  const hash = await bcrypt.hash('12345678', 12);
  
  // Fix typo in email and reset password
  await client.query('UPDATE users SET email=$1, password=$2 WHERE email=$3', [
    'pratapdas78488@gmail.com', hash, 'pratapdas78488@gmail.co'
  ]);
  
  // Also reset password for pw@gmail.com just in case
  await client.query('UPDATE users SET password=$1 WHERE email=$2', [
    hash, 'pw@gmail.com'
  ]);
  
  console.log('Updated users');
  client.end();
}

update().catch(console.error);
