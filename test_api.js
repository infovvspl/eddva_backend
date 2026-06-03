const jwt = require('jsonwebtoken');
const axios = require('axios');

const secret = 'your-super-secret-jwt-key-change-in-production';
const payload = {
  id: '3d0eabde-0695-4935-9dd9-da21ae1dced8',
  role: 'TEACHER',
  instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1'
};

const token = jwt.sign(payload, secret);

async function run() {
  try {
    console.log("Testing Chapter Creation...");
    const res = await axios.post('http://localhost:3000/api/v1/school/topics/chapters', {
      subjectId: '6bda44a0-0523-42cc-90f6-97e50286b91e',
      name: 'Test Chapter Auto',
      orderIndex: 1
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("Chapter Creation Success:", res.data);
    
    const chapterId = res.data.data.id;
    console.log("Testing Topic Creation with Chapter ID:", chapterId);
    const res2 = await axios.post('http://localhost:3000/api/v1/school/topics', {
      chapterId: chapterId,
      name: 'Test Topic Auto',
      orderIndex: 1
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("Topic Creation Success:", res2.data);
    
  } catch (err) {
    if (err.response) {
      console.error("HTTP Error:", err.response.status, err.response.data);
    } else {
      console.error("Network Error:", err.message);
    }
  }
}
run();
