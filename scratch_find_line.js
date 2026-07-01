const fs = require('fs');
const content = fs.readFileSync('d:/Edva/eddva_frontend/src/pages/student/StudentCourseDetailPage.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('max-w-')) {
    console.log(`${idx + 1}: ${line}`);
  }
});
