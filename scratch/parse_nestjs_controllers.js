const fs = require('fs');
const path = require('path');

const modulesDir = 'd:/Edva/eddva_backend/src/modules/school';
const controllers = [];

function scanDir(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (item.endsWith('.controller.ts')) {
      controllers.push(fullPath);
    }
  }
}

scanDir(modulesDir);

const routes = [];

for (const controllerFile of controllers) {
  const content = fs.readFileSync(controllerFile, 'utf-8');
  
  // Find Controller prefix
  const controllerMatch = content.match(/@Controller\(([^)]+)\)/);
  if (!controllerMatch) continue;
  
  let prefix = controllerMatch[1].trim().replace(/['"]/g, '');
  // Clean prefix if it is an array
  if (prefix.startsWith('[')) {
    prefix = prefix.replace(/[\[\]\s]/g, '').split(',')[0];
  }
  
  // Parse all HTTP methods
  const methodRegex = /@(Get|Post|Put|Delete|Patch)\(([^)]*)\)[\s\S]*?\s+(\w+)\s*\(([\s\S]*?)\)/g;
  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    const httpMethod = match[1];
    const subRoute = match[2].trim().replace(/['"]/g, '');
    const functionName = match[3];
    const paramsRaw = match[4];
    
    let fullRoute = `/${prefix}`;
    if (subRoute) {
      fullRoute = `/${prefix}/${subRoute}`.replace(/\/+/g, '/');
    }
    
    // Parse decorators inside parameter list like @Body(), @Query(), @Param()
    const bodyMatch = paramsRaw.match(/@Body\(\)\s+\w+:\s+(\w+)/);
    const queryMatch = paramsRaw.match(/@Query\(\)\s+\w+:\s+(\w+)/);
    const paramMatches = [...paramsRaw.matchAll(/@Param\(['"](\w+)['"]\)/g)].map(m => m[1]);
    
    routes.push({
      file: path.basename(controllerFile),
      httpMethod,
      route: fullRoute,
      functionName,
      bodyDto: bodyMatch ? bodyMatch[1] : null,
      queryDto: queryMatch ? queryMatch[1] : null,
      params: paramMatches,
    });
  }
}

fs.writeFileSync('d:/Edva/eddva_backend/scratch/parsed_routes.json', JSON.stringify(routes, null, 2), 'utf-8');
console.log(`Parsed ${routes.length} routes.`);
