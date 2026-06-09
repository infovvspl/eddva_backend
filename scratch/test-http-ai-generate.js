const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { getDataSourceToken } = require('@nestjs/typeorm');
const jwt = require('jsonwebtoken');
const axios = require('axios');

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  let teacherUser = null;
  try {
    const token = getDataSourceToken('school');
    const schoolDb = app.get(token);
    
    const users = await schoolDb.query("SELECT id, role, institute_id FROM users WHERE role='TEACHER' LIMIT 1");
    if (users.length > 0) {
      teacherUser = users[0];
    }
  } catch (dbErr) {
    console.error('Failed to query database:', dbErr);
  }

  if (!teacherUser) {
    console.error('No teacher user found in school database');
    await app.close();
    return;
  }

  console.log('Using real teacher user:', teacherUser);

  // Generate JWT token
  const payload = {
    id: teacherUser.id,
    role: teacherUser.role,
    instituteId: teacherUser.institute_id,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production');
  console.log('Generated JWT Token:', token);

  // Call the HTTP endpoint
  const url = 'http://localhost:3000/api/v1/school/assessments/ai-generate';
  const body = {
    title: 'HTTP AI Generate Test',
    type: 'topic',
    total_marks: 10,
    duration_minutes: 15,
    className: 'Class 10',
    subjectName: 'History',
    topicName: 'Mughal Empire',
    language: 'hi',
    mcqCount: 2,
    trueFalseCount: 0,
    fillBlankCount: 0,
    shortCount: 0,
    longCount: 0,
  };

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  console.log('Sending POST request to HTTP API...');
  try {
    const res = await axios.post(url, body, { headers });
    console.log('HTTP Response Status:', res.status);
    console.log('HTTP Response Data:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('HTTP Error Status:', err.response?.status);
    console.error('HTTP Error Data:', err.response?.data || err.message);
  }

  // Test the translate route
  const translateUrl = 'http://localhost:3000/api/v1/school/assessments/translate';
  const translateBody = {
    text: 'What are the main causes of the Mughal Empire decline?',
    language: 'hi',
  };
  console.log('Sending POST request to HTTP Translate API...');
  try {
    const res = await axios.post(translateUrl, translateBody, { headers });
    console.log('HTTP Translate Response Status:', res.status);
    console.log('HTTP Translate Response Data:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('HTTP Translate Error Status:', err.response?.status);
    console.error('HTTP Translate Error Data:', err.response?.data || err.message);
  }

  await app.close();
}

test();
