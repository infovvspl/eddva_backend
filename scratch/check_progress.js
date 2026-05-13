
import axios from 'axios';

async function checkProgress() {
  try {
    const resp = await axios.get('http://localhost:8080/student/progress-report', {
      headers: { 'x-tenant-id': 'default' } // Assuming default tenant
    });
    console.log(JSON.stringify(resp.data.summary, null, 2));
    console.log('Subjects:', resp.data.subjects.length);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

checkProgress();
