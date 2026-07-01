const { execSync } = require('child_process');
const fs = require('fs');

try {
  // Get all staged files
  const stdout = execSync('git diff --cached --name-only --diff-filter=ACM').toString();
  const files = stdout.split('\n').map(f => f.trim()).filter(f => f.length > 0);

  // Construct regex using escaped unicode sequences so this file itself doesn't trigger it
  // Match standard mojibake prefixes without using literal characters
  const mojibakeRegex = new RegExp('(\\u00F0\\u0178|\\u00E2\\u20AC|\\u00C2|\\u00C3)');
  let found = false;

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (mojibakeRegex.test(content)) {
      console.error(`\n❌ ERROR: Mojibake corruption detected in staged file: ${file}`);
      console.error(`   Please ensure your text editor is saving files with UTF-8 encoding.`);
      console.error(`   (Matched typical mojibake patterns)\n`);
      found = true;
    }
  }

  if (found) {
    process.exit(1);
  }
} catch (e) {
  console.error('Error running pre-commit check:', e.message);
  process.exit(1);
}
