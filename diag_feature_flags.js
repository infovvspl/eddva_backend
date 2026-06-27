// Diagnostic script - verify the JSONB merge fix
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const http = require('http');

const DB_URL = 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school';
const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';

function httpRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = http.request({
      hostname: 'localhost', port: 3000,
      path, method, headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Get the super admin user
  const adminRes = await client.query("SELECT id, email, role, institute_id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1");
  const admin = adminRes.rows[0];
  console.log('Super admin:', admin);

  // Create a valid JWT
  const token = jwt.sign(
    { sub: admin.id, userId: admin.id, email: admin.email, role: admin.role, instituteId: admin.institute_id },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log('JWT created (first 50 chars):', token.substring(0, 50) + '...');

  // Get institute
  const institutes = await client.query('SELECT id, name FROM institutes LIMIT 1');
  const inst = institutes.rows[0];
  console.log('Institute:', inst.id, inst.name);

  // STEP 1: Check DB before
  console.log('\n===== STEP 1: DB BEFORE =====');
  const before = await client.query('SELECT modules_permissions FROM institutes WHERE id = $1', [inst.id]);
  console.log('modules_permissions BEFORE:', JSON.stringify(before.rows[0].modules_permissions, null, 2));

  // STEP 2: PUT with only { assignments: false } via API
  console.log('\n===== STEP 2: PUT { modulesPermissions: { assignments: false } } =====');
  const putRes = await httpRequest('PUT', `/api/v1/school/institutes/${inst.id}`, { modulesPermissions: { assignments: false } }, token);
  console.log('PUT status:', putRes.status);
  if (putRes.status === 200 || putRes.status === 201) {
    console.log('PUT response modules_permissions:', JSON.stringify(putRes.body.modules_permissions, null, 2));
  } else {
    console.log('PUT response body:', JSON.stringify(putRes.body));
  }

  // STEP 3: Check DB after
  console.log('\n===== STEP 3: DB AFTER =====');
  const after = await client.query('SELECT modules_permissions FROM institutes WHERE id = $1', [inst.id]);
  const afterPerms = after.rows[0].modules_permissions;
  console.log('modules_permissions AFTER:', JSON.stringify(afterPerms, null, 2));

  // Verify: are all other keys still intact?
  const beforePerms = before.rows[0].modules_permissions;
  const beforeKeys = Object.keys(beforePerms);
  const afterKeys = Object.keys(afterPerms);
  console.log('\nKEY COUNT: before=' + beforeKeys.length + ', after=' + afterKeys.length);
  console.log('assignments value: before=' + beforePerms.assignments + ', after=' + afterPerms.assignments);
  
  // Check if any other keys changed
  let diffs = [];
  for (const k of beforeKeys) {
    if (k === 'assignments') continue;
    if (beforePerms[k] !== afterPerms[k]) {
      diffs.push(`${k}: ${beforePerms[k]} -> ${afterPerms[k]}`);
    }
  }
  if (diffs.length === 0) {
    console.log('✅ All other keys INTACT — only assignments changed');
  } else {
    console.log('❌ OTHER KEYS CHANGED:', diffs);
  }

  await client.end();
}

main().catch(console.error);
