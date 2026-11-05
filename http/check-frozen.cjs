'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const BASE_COMMIT = '25c3df109270ccf6f02b074f62a6f564f1efe0d5';
const MANIFEST_SHA256 = 'ddc174e071038a8124c33dd0dc0f8484da9437ddacbd700f1e006d7289e73582';
// Reviewed SKU guidance and page-stock diagnostic patches against 03bbfc4. Keep the original
// manifest immutable: only these exact artifacts may differ, never a directory.
const PATCH_COMMIT = '03bbfc45f50e713c9d0b241df69e1bffd2565b62';
const PATCHES = Object.freeze({
  'tools/shopping-prompts.cjs': Object.freeze({ before: 'cbb0e3f9dd5e5d4b9b6f74bc1411ddd2a2ba4349bdd59c342191f98c42dcdedb', after: 'd1c871c52f7ba1e604f4a17b14c53c669278580a6bc7e3679cb25e152ca341d8' }),
  'tests/sku-model-price.test.cjs': Object.freeze({ before: null, after: '4e2106c433d2f3f8b5cdc890ca14ad52cc6a456aec5470d03e3cdb7f92ab370c' }),
  'tests/fixtures/pdd-cpu-model-synthetic.json': Object.freeze({ before: null, after: '8945d3cf4a9756c210a0962d0ee66937c73bcb1b7cc6688244efb634a1a46f1d' }),
  'clis/pdd/_dom.cjs': Object.freeze({ before: '5cd786c5724ec60624c09fa3820b722d41eda0beb8cd901a76168e59e14bc56f', after: '96a7961c86d66ff47bcc3928fb65a21b602313a3c590db260fe4bb6769461563' }),
  'tools/pdd.cjs': Object.freeze({ before: 'fb1bfef60f0fe28a900f65055edf25fe93e571034cdb0cbad8ebd3edf64ec99d', after: 'dbc892e57519dba472c238f866679f8f6a5d3b745a7a9aec5f86a040d28cdb59' }),
  'tests/loaded-sku.test.cjs': Object.freeze({ before: '10c75919cba871a955dcfddd66cee6492497e69353e770e8e463e12ec7e83cfc', after: '4d64cf6811624acd5dd8600f69c350a0ac45f03707a3828d52edc3185f55919f' }),
  'tests/sku-stock.test.cjs': Object.freeze({ before: null, after: 'db7343a3bd5817e6c5ee0f4937b6b50124305a10fba121cac39fc059836bb770' }),
  'tests/fixtures/pdd-cpu-stock-2026-11-05.json': Object.freeze({ before: null, after: 'e4ccd05b12853e67b5d42e6c8c2eed3d7dbc1d8444733f0179700dd47a8c0ad9' })
});
const addedScripts = new Set(['check:frozen', 'setup:http', 'start:http', 'test:http']);
const canonical = value => Buffer.from(value.toString('utf8').replace(/\r\n/g, '\n'));
const digest = bytes => crypto.createHash('sha256').update(canonical(bytes)).digest('hex');
function protectedFile(file) {
  return /^(tools|clis|tests|scripts)\//.test(file) && file !== 'scripts/release.cjs' ||
    ['server.cjs', 'package-lock.json', 'Install.ps1', 'mcp-config.example.json', '.npmrc', '.editorconfig', '.gitattributes', 'LICENSE', 'LICENSING.md', 'NOTICE'].includes(file);
}
function checkFrozen({ root = path.resolve(__dirname, '..'), verifyGit = false } = {}) {
  const raw = fs.readFileSync(path.join(root, 'http', 'core-baseline.json'));
  assert.equal(digest(raw), MANIFEST_SHA256, '冻结清单发生变化；不能通过刷新清单放行核心修改。');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.source_commit, BASE_COMMIT, '冻结基线提交不一致。');
  for (const [file, patch] of Object.entries(PATCHES)) {
    assert.equal(manifest.files[file] ?? null, patch.before, `例外的修改前哈希与冻结基线不一致：${file}`);
  }
  const expectedFiles = { ...manifest.files, ...Object.fromEntries(Object.entries(PATCHES).map(([file, patch]) => [file, patch.after])) };
  const failures = [];
  for (const [file, expected] of Object.entries(expectedFiles)) {
    try {
      const target = path.join(root, file);
      if (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink() || digest(fs.readFileSync(target)) !== expected) failures.push(file);
    } catch { failures.push(file); }
  }
  function checkAdditions(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) { failures.push(relative); continue; }
      if (entry.isDirectory()) checkAdditions(relative);
      else if (/\.(?:cjs|js|json|ps1)$/.test(entry.name) && protectedFile(relative) && !Object.hasOwn(expectedFiles, relative)) failures.push(relative);
    }
  }
  for (const directory of ['tools', 'clis', 'tests', 'scripts']) checkAdditions(directory);
  const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const original = manifest.package;
  const { scripts: currentScripts, ...currentMetadata } = current;
  const { scripts: originalScripts, ...originalMetadata } = original;
  assert.deepEqual(currentMetadata, originalMetadata, '根 package.json 只能增加指定运行脚本，不能修改依赖或其他元数据。');
  for (const [name, command] of Object.entries(originalScripts)) assert.equal(currentScripts[name], command, `原运行脚本已改变：${name}`);
  for (const name of Object.keys(currentScripts)) assert.ok(Object.hasOwn(originalScripts, name) || addedScripts.has(name), `未允许的新增根脚本：${name}`);
  const release = fs.readFileSync(path.join(root, 'scripts/release.cjs'), 'utf8').replace(/\r\n/g, '\n');
  const originalRelease = manifest.release_source;
  const extendedRelease = originalRelease.replace("'tests', 'third-party'];", "'tests', 'third-party', 'http', '.github'];");
  assert.ok(release === originalRelease || release === extendedRelease, '发布脚本只允许扩展 HTTP 和 CI 文件收录白名单。');
  if (verifyGit) {
    const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const files = git(['ls-tree', '-rz', '--name-only', BASE_COMMIT]).toString().split('\0').filter(protectedFile).sort();
    assert.deepEqual(Object.keys(manifest.files).sort(), files, '冻结清单与固定提交的保护文件集合不一致。');
    for (const file of files) assert.equal(manifest.files[file], digest(git(['show', `${BASE_COMMIT}:${file}`])), `冻结哈希不来自固定提交：${file}`);
    assert.deepEqual(manifest.package, JSON.parse(git(['show', `${BASE_COMMIT}:package.json`])));
    assert.equal(manifest.release_source, git(['show', `${BASE_COMMIT}:scripts/release.cjs`]).toString().replace(/\r\n/g, '\n'));
    const patchFiles = new Set(git(['ls-tree', '-rz', '--name-only', PATCH_COMMIT]).toString().split('\0'));
    for (const [file, patch] of Object.entries(PATCHES)) {
      assert.equal(patchFiles.has(file), patch.before !== null, `例外的新增/修改类型与公开基线不一致：${file}`);
      if (patch.before !== null) assert.equal(digest(git(['show', `${PATCH_COMMIT}:${file}`])), patch.before, `例外的修改前哈希不来自公开基线：${file}`);
    }
  }
  if (failures.length) throw Error(`已验收核心发生修改、删除或重命名：${failures.join(', ')}`);
  return { status: 'ok', source_commit: BASE_COMMIT, protected_files: Object.keys(expectedFiles).length, reviewed_patch_base: PATCH_COMMIT, reviewed_patch_files: Object.keys(PATCHES), line_endings: 'Git LF（仅兼容 CRLF 检出差异）', git_verified: verifyGit };
}
if (require.main === module) {
  try { console.log(JSON.stringify(checkFrozen({ verifyGit: process.argv.includes('--verify-git') }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkFrozen, protectedFile, digest, BASE_COMMIT };
