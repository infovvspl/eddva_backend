const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\e01a0841-3392-4717-aa59-13928653a9fc\\.system_generated\\logs\\transcript.jsonl';

try {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  
  console.log("Analyzing log file lines:", lines.length);
  
  // Let's print out all step index, source, and types
  const userSteps = [];
  lines.forEach((line) => {
    const obj = JSON.parse(line);
    if (obj.source === 'USER_EXPLICIT' && obj.type === 'USER_INPUT') {
      userSteps.push({
        index: obj.step_index,
        content: obj.content
      });
    }
  });
  
  console.log("User requests list:");
  console.log(JSON.stringify(userSteps, null, 2));

} catch (err) {
  console.error("Failed to read logs:", err);
}
