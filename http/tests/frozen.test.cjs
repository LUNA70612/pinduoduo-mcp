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
  for (const file of [...Object.keys(manifest.files), 'tests/sku-model-price.test.cjs', 'tests/fixtures/pdd-cpu-model-synthetic.json', 'tests/sku-stock.test.cjs', 'tests/fixtures/pdd-cpu-stock-2026-11-05.json', 'package.json', 'scripts/release.cjs', 'http/core-baseline.json']) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

for (const file of ['tools/shopping-prompts.cjs', 'tests/sku-model-price.test.cjs', 'tests/fixtures/pdd-cpu-model-synthetic.json', 'clis/pdd/_dom.cjs', 'tools/pdd.cjs', 'tests/loaded-sku.test.cjs', 'tests/sku-stock.test.cjs', 'tests/fixtures/pdd-cpu-stock-2026-11-05.json']) {
  test(`narrow SKU exception accepts only the reviewed hash: ${file}`, t => {
    const directory = copy(t);
    assert.equal(checkFrozen({ root: directory }).status, 'ok');
    fs.appendFileSync(path.join(directory, file), '\n ');
    assert.throws(() => checkFrozen({ root: directory }), /发生修改/);
  });
}

for (const file of ['scripts/doctor.cjs', 'tools/opencli-runtime.cjs', 'tests/startup.test.cjs']) {
  test(`startup exception accepts only its reviewed hash and rejects removal or rename: ${file}`, t => {
    const directory = copy(t), target = path.join(directory, file), original = fs.readFileSync(target);
    assert.equal(checkFrozen({ root: directory }).status, 'ok');
    fs.appendFileSync(target, '\n ');
    assert.throws(() => checkFrozen({ root: directory }), /发生修改/);
    fs.writeFileSync(target, original);
    fs.renameSync(target, `${target}.renamed`);
    assert.throws(() => checkFrozen({ root: directory }), /发生修改/);
    fs.unlinkSync(`${target}.renamed`);
    assert.throws(() => checkFrozen({ root: directory }), /发生修改/);
  });
}

test('a patch exception cannot silently remove the reviewed client guidance', t => {
  const directory = copy(t);
  const file = path.join(directory, 'tools/shopping-prompts.cjs');
  fs.unlinkSync(file);
  assert.throws(() => checkFrozen({ root: directory }));
});
test('fixed baseline matches Git, while CRLF checkout differences are harmless', t => {
  const hasGit = fs.existsSync(path.join(root, '.git'));
  assert.equal(checkFrozen({ root, verifyGit: hasGit }).status, 'ok');
  if (!hasGit) t.diagnostic('源码ZIP按已固定清单验证；Git提交交叉核对由仓库CI执行。');
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
