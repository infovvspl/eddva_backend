const axios = require('axios');

async function run() {
  try {
    const res = await axios.put('http://localhost:8081/api/v1/school/subjects/6bda44a0-0523-42cc-90f6-97e50286b91e', {
      name: 'Math',
      code: 'MATH101',
      description: 'Advanced Mathematics',
      type: 'Theory',
      classId: '39587a4b-1574-47e1-854a-0904c233c646',
      sectionId: '36e3f15a-013a-4fa3-a8e2-7e78bd2fbfd5'
    }, {
      headers: {
        'x-tenant-id': 'admin',
        // We might need authorization header, but let's see if the auth guard requires it.
      }
    });
    console.log(res.data);
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}
run();
