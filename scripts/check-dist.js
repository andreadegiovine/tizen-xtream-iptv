/* Fails when the built JavaScript uses syntax the TV (Chromium ~76, ES2019) cannot parse, e.g. `??` or `?.` written by the minifier. */
const fs = require('fs');
const path = require('path');
// acorn is installed with webpack.
const acorn = require('acorn');

const dist = path.resolve(__dirname, '..', 'dist');
const files = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  });
};
walk(path.join(dist, 'js'));
walk(path.join(dist, 'service'));

let failed = 0;
files.forEach((file) => {
  try {
    acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 2019 });
  } catch (err) {
    failed += 1;
    const source = fs.readFileSync(file, 'utf8');
    const at = err.pos || 0;
    console.error(`${path.relative(dist, file)}: ${err.message}\n  ...${source.slice(Math.max(0, at - 60), at + 40)}...`);
  }
});
if (!files.length) {
  console.error('check-dist: nothing to check, run the build first.');
  process.exit(1);
}
if (failed) process.exit(1);
console.log(`check-dist: ${files.length} files parse as ES2019.`);
