const axios = require('axios');

async function testGrading() {
  const payload = {
    questionText: "Describe Lenecho's faith is God. 8",
    maxMarks: 8,
    studentAnswer: "The lungs serve as the primary organ for gas exchange in the body. They bring oxygen into the bloodstream and remove carbon dioxide waste.",
    criteria: [
      { text: "Content", marks: 4 },
      { text: "Grammar", marks: 4 }
    ],
    keyConcepts: ["faith", "God"],
    modelAnswer: "Lencho had deep faith in God."
  };

  try {
    console.log("Sending request to subjective grading endpoint...");
    const res = await axios.post(
      "http://127.0.0.1:8000/grading/subjective-answer",
      payload,
      {
        headers: {
          'X-API-Key': 'apexiq-dev-secret-key-2026',
          'x-tenant-id': 'c259cd4e-b018-45e2-8e46-52a497ca49a1',
          'x-vertical': 'school',
          'x-board': 'CBSE'
        }
      }
    );
    console.log("RESPONSE SUCCESS:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error("RESPONSE ERROR:", err.response ? {
      status: err.response.status,
      data: err.response.data
    } : err.message);
  }
}

testGrading();
