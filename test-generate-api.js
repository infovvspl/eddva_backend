const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

async function run() {
  try {
    // Generate an admin token for API request
    const loginRes = await axios.post('http://localhost:3000/school/auth/institute-admin/login', {
      email: 'admin@apexiq.edu',
      password: 'password123'
    });
    const token = loginRes.data.data.accessToken;

    console.log("Got token");

    // Fetch templates to get ID card template ID
    const templatesRes = await axios.get('http://localhost:3000/school/institute-admin/document/template/ID_CARD_STUDENT', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const idCardTemplateId = templatesRes.data.data[0].id;
    console.log("Using template:", idCardTemplateId);

    // Call generate ID card API
    const generateRes = await axios.post('http://localhost:3000/school/institute-admin/document/generate/id-card', {
      targetType: 'CLASS', // just pass CLASS without classId to see if it works, or we need classId
    }, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(e => {
       console.log(e.response?.data);
       return null;
    });
    
    if (generateRes && generateRes.data.pdfBase64) {
      fs.writeFileSync('test-id-card.pdf', Buffer.from(generateRes.data.pdfBase64, 'base64'));
      console.log("Saved PDF to test-id-card.pdf");
    }

  } catch (e) {
    console.error(e.message);
  }
}
run();
