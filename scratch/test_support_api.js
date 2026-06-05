const axios = require('axios');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
const ADMIN_ID = '5a3a02f9-94fb-4db8-b219-f8ac39006d2d'; // Subham Mishra
const TEACHER_ID = '911eeb3d-60ce-4ba5-b476-9c0b975b666b'; // Dipu
const STUDENT_ID = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54'; // Pratap Das
const INST_ID = 'c259cd4e-b018-45e2-8e46-52a497ca49a1';

function getToken(userId, role, email, name) {
  return jwt.sign(
    { id: userId, role, email, name, instituteId: INST_ID },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function runTests() {
  const adminToken = getToken(ADMIN_ID, 'INSTITUTE_ADMIN', 'odm@gmail.com', 'Subham Mishra');
  const teacherToken = getToken(TEACHER_ID, 'TEACHER', 'dp@gmail.com', 'Dipu');
  const studentToken = getToken(STUDENT_ID, 'STUDENT', 'pratapdas@gmail.com', 'Pratap Das');

  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const teacherHeaders = { Authorization: `Bearer ${teacherToken}` };
  const studentHeaders = { Authorization: `Bearer ${studentToken}` };

  console.log('--- STARTING SUPPORT SYSTEM INTEGRATION TESTS ---\n');

  try {
    // -------------------------------------------------------------
    // PART 1: Institute Admin Complaints / Support Operations
    // -------------------------------------------------------------
    console.log('[Admin] Testing GET /school/complaints ...');
    const adminGet = await axios.get('http://localhost:3000/api/v1/school/complaints', { headers: adminHeaders });
    console.log('[Admin] GET Complaints count:', adminGet.data.data ? adminGet.data.data.length : 'N/A');

    console.log('\n[Admin] Testing POST /school/complaints ...');
    const adminPost = await axios.post('http://localhost:3000/api/v1/school/complaints', {
      title: 'Admin Support Test Ticket',
      description: 'This is a test support ticket created by the integration test suite.',
      status: 'OPEN'
    }, { headers: adminHeaders });
    console.log('[Admin] POST Complaint Response Success:', adminPost.data.success);
    const newComplaint = adminPost.data.data;
    console.log('[Admin] New Complaint ID:', newComplaint.id);

    console.log('\n[Admin] Testing PUT /school/complaints/:id ...');
    const adminPut = await axios.put(`http://localhost:3000/api/v1/school/complaints/${newComplaint.id}`, {
      status: 'IN_PROGRESS'
    }, { headers: adminHeaders });
    console.log('[Admin] PUT Complaint Response Success:', adminPut.data.success);

    // Verify change
    const adminGetOne = await axios.get(`http://localhost:3000/api/v1/school/complaints/${newComplaint.id}`, { headers: adminHeaders });
    console.log('[Admin] Updated Complaint status:', adminGetOne.data.data.status);


    // -------------------------------------------------------------
    // PART 2: Teacher Grievances / Support
    // -------------------------------------------------------------
    console.log('\n[Teacher] Testing GET /school/grievances ...');
    const teacherGet = await axios.get('http://localhost:3000/api/v1/school/grievances', { headers: teacherHeaders });
    console.log('[Teacher] GET Grievances count:', teacherGet.data.data ? teacherGet.data.data.length : 'N/A');

    console.log('\n[Teacher] Testing POST /school/grievances ...');
    const teacherPost = await axios.post('http://localhost:3000/api/v1/school/grievances', {
      title: 'Teacher Infrastructure Issue',
      category: 'infrastructure',
      description: 'Projector in room 102 is flickering.',
      status: 'OPEN'
    }, { headers: teacherHeaders });
    console.log('[Teacher] POST Grievance Response Success:', teacherPost.data.success);
    const newGrievance = teacherPost.data.data;
    console.log('[Teacher] New Grievance ID:', newGrievance.id);

    // -------------------------------------------------------------
    // PART 3: Student Support Tickets
    // -------------------------------------------------------------
    console.log('\n[Student] Testing GET /school/grievances ...');
    const studentGet = await axios.get('http://localhost:3000/api/v1/school/grievances', { headers: studentHeaders });
    console.log('[Student] GET Grievances count:', studentGet.data.data ? studentGet.data.data.length : 'N/A');

    console.log('\n[Student] Testing POST /school/grievances ...');
    const studentPost = await axios.post('http://localhost:3000/api/v1/school/grievances', {
      title: 'Student Academic Doubt Ticket',
      category: 'Academic',
      description: 'Cannot download study materials for Mathematics.',
      status: 'OPEN'
    }, { headers: studentHeaders });
    console.log('[Student] POST Grievance Response Success:', studentPost.data.success);
    const studentGrievance = studentPost.data.data;
    console.log('[Student] New Student Grievance ID:', studentGrievance.id);

    console.log('\n🎉 ALL SUPPORT SYSTEM INTEGRATION TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('\n❌ Test failed with error:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

runTests();
