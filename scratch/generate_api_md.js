const fs = require('fs');
const path = require('fs');

const routes = JSON.parse(fs.readFileSync('d:/Edva/eddva_backend/scratch/parsed_routes.json', 'utf-8'));

const groups = {
  superAdmin: [],
  admin: [],
  teacher: [],
  student: [],
  parent: [],
  generalAcademic: [],
  other: []
};

for (const r of routes) {
  const routeLower = r.route.toLowerCase();
  const fileLower = r.file.toLowerCase();
  
  if (routeLower.includes('super-admin') || fileLower.includes('super-admin')) {
    groups.superAdmin.push(r);
  } else if (routeLower.includes('parent') || fileLower.includes('parent')) {
    groups.parent.push(r);
  } else if (routeLower.includes('student') || fileLower.includes('student') || fileLower.includes('gamification')) {
    groups.student.push(r);
  } else if (routeLower.includes('teacher') || fileLower.includes('teacher') || fileLower.includes('assignment') || fileLower.includes('assessment')) {
    groups.teacher.push(r);
  } else if (routeLower.includes('admin') || fileLower.includes('admin') || fileLower.includes('security') || fileLower.includes('institute') || fileLower.includes('audit-logs')) {
    groups.admin.push(r);
  } else if (fileLower.includes('academic') || fileLower.includes('subject') || fileLower.includes('topic') || fileLower.includes('class') || fileLower.includes('timetable') || fileLower.includes('schedule') || fileLower.includes('material')) {
    groups.generalAcademic.push(r);
  } else {
    groups.other.push(r);
  }
}

let md = `# School Vertical - Exhaustive Role-Wise API Reference

This document lists all **343 backend routes** detected across the school NestJS controllers, grouped by roles and modules to aid in mobile application development.

---

`;

function formatRouteSection(title, list) {
  let section = `## ${title} (${list.length} Endpoints)\n\n`;
  if (list.length === 0) {
    section += `*No endpoints in this group.*\n\n`;
    return section;
  }
  
  section += `| Method | Route | Function / DTO |\n`;
  section += `| :--- | :--- | :--- |\n`;
  for (const r of list) {
    let details = `**Func**: \`${r.functionName}\``;
    if (r.bodyDto) details += `<br>**Body**: \`${r.bodyDto}\``;
    if (r.queryDto) details += `<br>**Query**: \`${r.queryDto}\``;
    if (r.params && r.params.length > 0) details += `<br>**Params**: \`${r.params.join(', ')}\``;
    
    section += `| \`${r.httpMethod.toUpperCase()}\` | \`${r.route}\` | ${details} |\n`;
  }
  section += `\n`;
  return section;
}

md += formatRouteSection('1. Super Admin Portal', groups.superAdmin);
md += formatRouteSection('2. Parent Portal', groups.parent);
md += formatRouteSection('3. Student Portal', groups.student);
md += formatRouteSection('4. Teacher Portal', groups.teacher);
md += formatRouteSection('5. School/Institute Admin Portal', groups.admin);
md += formatRouteSection('6. General Academic & Content management', groups.generalAcademic);
md += formatRouteSection('7. Shared / Infrastructure Endpoints', groups.other);

fs.writeFileSync('C:/Users/HP/.gemini/antigravity-ide/brain/8c171901-a595-48f7-ad97-56c7c8d86250/school_api_documentation.md', md, 'utf-8');
console.log('Markdown generated.');
