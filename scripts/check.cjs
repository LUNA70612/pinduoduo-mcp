'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const files = [];
function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (['node_modules', '.git', '.cache', 'runtime', 'work', 'outputs'].includes(e.name)) continue; if (e.isDirectory()) walk(p); else if (/\.(cjs|js)$/.test(e.name)) files.push(p); } }
walk(root);
for (const file of files) { const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true }); if (r.status !== 0) { process.stderr.write(`${file}: ${r.error?.message || r.stderr || r.stdout || `exit ${r.status}`}\n`); process.exit(1); } }
console.log(`Syntax checks passed: ${files.length} files`);
