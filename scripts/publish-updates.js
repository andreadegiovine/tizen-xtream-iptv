#!/usr/bin/env node
/*
 * Writes the online builds of one version into a checkout of the gh-pages branch (used by the release workflow, see
 * src/services/updates.js): bundles/<version>/<platform>/ (the web code of each platform's build) and version.json. Keeps the last
 * KEEP versions. Usage: node scripts/publish-updates.js <pages dir> <version> <platform>=<build dir> [...]
 */
const fs = require('fs');
const path = require('path');

const KEEP = 3;
// The web code of a build: what the app loads from a build published online (the package's own files stay in the package).
const WEB = ['js', 'css', 'fonts'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach((entry) => {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  });
}

const compare = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

function main() {
  const [pagesDir, version, ...builds] = process.argv.slice(2);
  if (!pagesDir || !/^\d+\.\d+\.\d+$/.test(version || '') || !builds.length) {
    console.error('usage: publish-updates.js <pages dir> <x.y.z> <platform>=<build dir> ...');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const minShell = (pkg.updates && pkg.updates.minShell) || '0.0.0';
  const platforms = {};
  builds.forEach((arg) => {
    const [name, dir] = arg.split('=');
    const target = path.join(pagesDir, 'bundles', version, name);
    fs.rmSync(target, { recursive: true, force: true });
    WEB.forEach((sub) => {
      if (fs.existsSync(path.join(dir, sub))) copyDir(path.join(dir, sub), path.join(target, sub));
    });
    if (!fs.existsSync(path.join(target, 'js', 'main.js'))) throw new Error(`${name}: no js/main.js in ${dir}`);
    // The scripts and stylesheets of the build (pages and workers are files of their own): the app downloads them all when it installs it.
    const files = ['js', 'css'].flatMap((sub) => (fs.existsSync(path.join(target, sub)) ? fs.readdirSync(path.join(target, sub)).map((f) => `${sub}/${f}`) : []));
    fs.writeFileSync(path.join(target, 'files.json'), `${JSON.stringify({ files: files.sort() })}\n`);
    platforms[name] = { base: `bundles/${version}/${name}/`, minShell };
  });
  fs.writeFileSync(path.join(pagesDir, 'version.json'), `${JSON.stringify({ version, date: new Date().toISOString(), platforms }, null, 2)}\n`);
  // Older versions beyond the last KEEP are removed (an app still on one of them updates to the latest).
  const all = fs.existsSync(path.join(pagesDir, 'bundles')) ? fs.readdirSync(path.join(pagesDir, 'bundles')).filter((v) => /^\d+\.\d+\.\d+$/.test(v)) : [];
  all.sort(compare).slice(0, Math.max(0, all.length - KEEP)).forEach((old) => fs.rmSync(path.join(pagesDir, 'bundles', old), { recursive: true, force: true }));
  console.log(`version.json → ${version} (${Object.keys(platforms).join(', ')}), min package ${minShell}`);
}

main();
