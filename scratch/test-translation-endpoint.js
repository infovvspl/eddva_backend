const axios = require('axios');

async function run() {
  const url = 'http://localhost:8000/translate';
  const apiKey = 'apexiq-dev-secret-key-2026';
  
  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
  };
  
  const body = {
    text: 'What is the capital of India?',
    targetLanguage: 'hi',
  };
  
  console.log('Testing translation to Hindi...');
  try {
    const res = await axios.post(url, body, { headers });
    console.log('Hindi Response:', res.data);
  } catch (err) {
    console.error('Hindi Error:', err.response?.status, err.response?.data || err.message);
  }

  const bodyOd = {
    text: 'What is the capital of India?',
    targetLanguage: 'od',
  };
  
  console.log('Testing translation to Odia...');
  try {
    const res = await axios.post(url, bodyOd, { headers });
    console.log('Odia Response:', res.data);
  } catch (err) {
    console.error('Odia Error:', err.response?.status, err.response?.data || err.message);
  }
}

run();
