'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkFrozen } = require('../check-frozen.cjs');
const root = path.resolve(__dirname, '../..');
function copy(t) {
  const base = path.join(root, 'work', 'http-freeze-tests'); fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'case-'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'http/core-baseline.json')));
  for (const file of [...Object.keys(manifest.files), 'package.json', 'scripts/release.cjs', 'http/core-baseline.json']) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('fixed baseline matches Git, while CRLF checkout differences are harmless', t => {
  assert.equal(checkFrozen({ root, verifyGit: true }).status, 'ok');
  const directory = copy(t), file = path.join(directory, 'server.cjs');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  assert.equal(checkFrozen({ root: directory }).status, 'ok');
});
for (const mutation of ['edit', 'delete', 'rename', 'addition', 'manifest', 'dependency', 'script', 'release']) {
  test(`freeze rejects ${mutation}`, t => {
    const directory = copy(t), file = path.join(directory, 'server.cjs');
    if (mutation === 'edit') fs.appendFileSync(file, '\n// changed\n');
    if (mutation === 'delete') fs.unlinkSync(file);
    if (mutation === 'rename') fs.renameSync(file, `${file}.renamed`);
    if (mutation === 'addition') fs.writeFileSync(path.join(directory, 'tools/extra-reader.cjs'), '// added core reader');
    if (mutation === 'manifest') fs.appendFileSync(path.join(directory, 'http/core-baseline.json'), ' ');
    if (['dependency', 'script'].includes(mutation)) {
      const packageFile = path.join(directory, 'package.json'), data = JSON.parse(fs.readFileSync(packageFile));
      if (mutation === 'dependency') data.dependencies['@jackwener/opencli'] = '3.0.0'; else data.scripts.start = 'node replaced.cjs';
      fs.writeFileSync(packageFile, JSON.stringify(data));
    }
    if (mutation === 'release') fs.appendFileSync(path.join(directory, 'scripts/release.cjs'), '\n// changed\n');
    assert.throws(() => checkFrozen({ root: directory }));
  });
}
