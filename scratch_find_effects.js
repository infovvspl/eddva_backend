const fs = require('fs');
const content = fs.readFileSync('d:/Edva/eddva_frontend/src/pages/student/StudentLecturePage.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('useEffect(')) {
    console.log(`${idx + 1}: ${line}`);
    // Print next 5 lines
    for (let i = 1; i <= 6; i++) {
      console.log(`  ${idx + 1 + i}: ${lines[idx + i]}`);
    }
  }
});
