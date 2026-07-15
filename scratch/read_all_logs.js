const fs = require('fs');

const logPath = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\e01a0841-3392-4717-aa59-13928653a9fc\\.system_generated\\logs\\transcript.jsonl';

try {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  
  const userSteps = [];
  lines.forEach((line) => {
    const obj = JSON.parse(line);
    if (obj.source === 'USER_EXPLICIT' && obj.type === 'USER_INPUT') {
      const match = obj.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      const reqText = match ? match[1].trim() : obj.content.trim();
      userSteps.push({
        index: obj.step_index,
        request: reqText
      });
    }
  });
  
  userSteps.forEach(step => {
    console.log(`Step ${step.index}: ${step.request}`);
  });

} catch (err) {
  console.error("Failed to read logs:", err);
}
