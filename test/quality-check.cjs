const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', '.git'].includes(entry.name) ? [] : walk(fullPath);
    }
    return [fullPath];
  });
}

const files = walk(root);
const javascriptFiles = files.filter(file => file.endsWith('.cjs'));
for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `${file} failed syntax check.\n`);
    process.exit(result.status || 1);
  }
}

const jsonFiles = files.filter(file => file.endsWith('.json'));
for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(root, file)} is not valid JSON: ${error.message}`);
  }
}

console.log(`Checked ${javascriptFiles.length} CommonJS files and ${jsonFiles.length} JSON files.`);
