const fs = require('fs');
const content = fs.readFileSync('c:/EDDVA SCHOOL/eddva_backend/src/modules/school/assessment/school-assessment.service.ts', 'utf8');

const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim().startsWith('async ') || (line.includes('class ') && line.includes('Service'))) {
    console.log(`${i + 1}: ${line.trim()}`);
  }
}
