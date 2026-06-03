const fs = require('fs');

async function testPPT() {
  const payload = {
    topic: "Photosynthesis",
    classLevel: "9",
    subject: "Biology",
    board: "CBSE"
  };

  try {
    const res = await fetch('http://localhost:3000/api/v1/school/creator-studio/ppt/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const buffer = await res.arrayBuffer();
    fs.writeFileSync('test.pptx', Buffer.from(buffer));
    console.log(`✅ Success! test.pptx generated. Size: ${buffer.byteLength} bytes.`);
  } catch (err) {
    console.error("❌ Test failed:", err);
  }
}

testPPT();
