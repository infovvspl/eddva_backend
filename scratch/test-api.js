const { DataSource } = require('typeorm');
const dotenv = require('dotenv');
const { SchoolSecurityService } = require('./src/modules/school/security/school-security.service');

dotenv.config({ path: '.env' });

const ds = new DataSource({
  name: 'school',
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await ds.initialize();
  const service = new SchoolSecurityService(ds, null);

  const mockUser = { role: 'SUPER_ADMIN' };

  console.log('--- GET /school/admin/security/summary ---');
  const summary = await service.getSummary(mockUser);
  console.log(summary);

  console.log('--- GET /school/admin/security/sessions ---');
  const sessions = await service.getActiveSessions(mockUser);
  console.log('Count:', sessions.length);
  console.log('First session:', sessions[0]);

  await ds.destroy();
}

run().catch(console.error);
