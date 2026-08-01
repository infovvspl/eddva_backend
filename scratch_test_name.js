const { DataSource } = require('typeorm');
require('dotenv').config();

async function testAny() {
  const coachingDs = new DataSource({
    type: 'postgres',
    url: process.env.COACHING_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await coachingDs.initialize();

    const ids = ['1d7b1082-c59f-4ef0-9b96-69aa162fdf37'];
    
    // Method 1: passing duplicated parameters for IN ($1) ... IN ($2)
    const p1 = ids.map((_, i) => `$${i + 1}`).join(',');
    const p2 = ids.map((_, i) => `$${i + 1 + ids.length}`).join(',');
    const p3 = ids.map((_, i) => `$${i + 1 + ids.length * 2}`).join(',');

    const sql = `
      SELECT u.id::text as u_id, s.id::text as s_id, s.user_id::text as s_u_id, u.full_name
      FROM users u
      LEFT JOIN students s ON s.user_id::text = u.id::text
      WHERE u.id::text IN (${p1}) OR s.id::text IN (${p2}) OR s.user_id::text IN (${p3})
    `;

    const users = await coachingDs.query(sql, [...ids, ...ids, ...ids]);
    console.log('Users found with repeated parameters:', users);

  } catch (e) {
    console.error('Error:', e);
  } finally {
    if (coachingDs.isInitialized) await coachingDs.destroy();
  }
}

testAny();
