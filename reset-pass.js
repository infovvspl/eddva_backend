const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

async function resetPassword() {
  await client.connect();
  const hash = await bcrypt.hash('password123', 10);
  await client.query("UPDATE users SET password = $1 WHERE email = 'rs@gmail.com'", [hash]);
  console.log('Password reset successfully for rs@gmail.com to password123');
  await client.end();
}

resetPassword().catch(console.error);
