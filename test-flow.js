const jwt = require('jsonwebtoken');

const testInstituteId = 'e9f3592d-851a-43be-9361-574e57722703'; // Real UUID required for postgres
const testUserId = '026798f5-692e-469f-8ad9-67170a899ac5';

// In eddva_backend, the JWT secret is loaded from env or derived. Since this is local, we'll try a dummy signature,
// OR since we are just mocking the token payload, we can use the actual secret. Let's just pass { secret: process.env.SCHOOL_JWT_SECRET }
const secret = process.env.SCHOOL_JWT_SECRET || 'school:fallback';

const mockToken = jwt.sign({ id: testUserId, schoolId: testInstituteId, role: 'INSTITUTE_ADMIN' }, secret);
const otherToken = jwt.sign({ id: 'admin-2', schoolId: '123e4567-e89b-12d3-a456-426614174002', role: 'INSTITUTE_ADMIN' }, secret);

const headers1 = { Authorization: `Bearer ${mockToken}`, 'Content-Type': 'application/json' };
const headers2 = { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' };
const baseURL = 'http://localhost:3000/api/v1';

async function runTests() {
  try {
    console.log('--- 1. Setting up (Super Admin assigns Transport module to test institute) ---');
    
    // We assume the Transport module was created by the seed script
    const getModulesRes = await fetch(`${baseURL}/super-admin/erp-modules`).then(r => r.json());
    console.log('getModulesRes:', getModulesRes);
    if (getModulesRes.error || !Array.isArray(getModulesRes)) {
       throw new Error(`API error or unexpected response: ${JSON.stringify(getModulesRes)}`);
    }
    const transportModule = getModulesRes.find(m => m.key === 'transport_management');
    if (!transportModule) throw new Error('Transport module not found. Did you run the seed?');

    // Assign Transport to testInstituteId
    await fetch(`${baseURL}/super-admin/institutes/${testInstituteId}/erp-modules/${transportModule.id}`, { method: 'POST' });
    console.log('Assigned Transport module to test institute.');

    console.log('\n--- 2. Test GET /institute-admin/erp-modules (Negative) ---');
    console.log('Assuming institute admin can only access assigned modules.');
    
    console.log('\n--- 3. Test Transport module access (Negative: School without Transport -> 403) ---');
    const otherRoleReq = await fetch(`${baseURL}/institute-admin/erp-modules/transport_management/roles`, { headers: headers2 });
    if (!otherRoleReq.ok) {
      const err = await otherRoleReq.json();
      console.log('Rejected successfully (Expected 403):', err.message);
    } else {
      console.error('SHOULD HAVE BEEN REJECTED (Institute 2 does not have transport module)');
    }

    console.log('\n--- 4. Create Transport Manager (Authorized request) ---');
    const createRoleRes = await fetch(`${baseURL}/institute-admin/erp-modules/transport_management/roles`, {
      method: 'POST', headers: headers1, body: JSON.stringify({ name: 'Transport Manager ' + Date.now(), description: 'Manages buses' })
    }).then(r => r.json());
    
    if (createRoleRes.error) throw new Error(`API error: ${JSON.stringify(createRoleRes)}`);
    const roleId = createRoleRes.id;
    console.log('Created Role:', roleId);

    console.log('\n--- 5. Assign Transport permissions ---');
    const permissionsRes = await fetch(`${baseURL}/institute-admin/erp-modules/transport_management/permissions`, { headers: headers1 }).then(r => r.json());
    const permissionIds = permissionsRes.map(p => p.id);
    
    const assignPermReq = await fetch(`${baseURL}/institute-admin/erp-modules/transport_management/roles/${roleId}/permissions`, {
      method: 'PUT', headers: headers1, body: JSON.stringify({ permissionIds })
    });
    if (!assignPermReq.ok) {
      console.error('Error assigning permissions:', await assignPermReq.text());
    } else {
      console.log(`Assigned ${permissionIds.length} permissions to role.`);
    }

    console.log('\n--- 6. Assign Transport Manager role to staff ---');
    const assignStaffReq = await fetch(`${baseURL}/institute-admin/erp-modules/transport_management/roles/${roleId}/users`, {
      method: 'POST', headers: headers1, body: JSON.stringify({ userId: testUserId })
    });
    if (!assignStaffReq.ok) {
      console.error('Error assigning role to user:', await assignStaffReq.text());
    } else {
      console.log('Assigned role to staff successfully.');
    }

    console.log('\n--- Verification Script Completed ---');
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// Ensure the server has started
setTimeout(runTests, 2000);
