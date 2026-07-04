const fs = require('fs');

const urlsFile = 'd:/Edva/eddva_ai_service/ai_services/urls.py';
const docFile = 'C:/Users/HP/.gemini/antigravity-ide/brain/8c171901-a595-48f7-ad97-56c7c8d86250/school_api_documentation.md';

const content = fs.readFileSync(urlsFile, 'utf-8');

// Parse Django path patterns, e.g. path("doubt/resolve", bridge.resolve_doubt),
const pathRegex = /path\((['"])([^'"]+)\1,\s*([\w.]+)\),?/g;
const aiRoutes = [];

let match;
while ((match = pathRegex.exec(content)) !== null) {
  const route = match[2];
  const handler = match[3];
  
  // Identify role based on endpoint prefix
  let role = 'General / Integrated';
  if (route.startsWith('tutor') || route.startsWith('doubt') || route.startsWith('recommend') || route.startsWith('personalization') || route.startsWith('plan')) {
    role = 'Student';
  } else if (route.startsWith('career')) {
    role = 'Student / Career Guidance';
  } else if (route.startsWith('stt') || route.startsWith('content/generate') || route.startsWith('ppt')) {
    role = 'Teacher';
  } else if (route.startsWith('admin-api')) {
    role = 'Admin';
  }
  
  aiRoutes.push({ route, handler, role });
}

let aiSection = `\n## 8. AI Engine Endpoints (Django Service - ${aiRoutes.length} Endpoints)\n\n`;
aiSection += `These represent the core AI endpoints hosted by the python AI vertical that the NestJS backend bridges to or that are queried directly for AI tasks.\n\n`;
aiSection += `| Method | AI Route (Base Url: AI_BASE_URL) | Target Handler | Primary Role / Context |\n`;
aiSection += `| :--- | :--- | :--- | :--- |\n`;

for (const r of aiRoutes) {
  // Most of these are POST requests for processing payloads, status checks are GET.
  const method = (r.route.includes('status') || r.route.includes('list') || r.route.includes('health') || r.route.includes('info') || r.route.includes('usage')) ? 'GET' : 'POST';
  aiSection += `| \`${method}\` | \`/${r.route}\` | \`${r.handler}\` | **${r.role}** |\n`;
}

fs.appendFileSync(docFile, aiSection, 'utf-8');
console.log('AI routes appended to documentation.');
