const fs = require('fs');
const path = require('path');

function walk(dir) {
  fs.readdirSync(dir).forEach(f => {
    let p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith('.ts')) {
      let c = fs.readFileSync(p, 'utf8');
      let nc = c.replace(/from\s+["'](\.[^"']+)["']/g, (match, p1) => {
        return match.replace(p1, p1.replace(/\.js$/, ''));
      });
      if (c !== nc) {
        fs.writeFileSync(p, nc);
      }
    }
  });
}

walk('c:/EDDVA SCHOOL/eddva_backend/src/modules/school/creator-studio/ppt');
