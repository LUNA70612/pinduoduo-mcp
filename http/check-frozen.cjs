'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const BASE_COMMIT = '25c3df109270ccf6f02b074f62a6f564f1efe0d5';
const MANIFEST_SHA256 = 'ddc174e071038a8124c33dd0dc0f8484da9437ddacbd700f1e006d7289e73582';
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
  const failures = [];
  for (const [file, expected] of Object.entries(manifest.files)) {
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
      else if (/\.(?:cjs|js|json|ps1)$/.test(entry.name) && protectedFile(relative) && !Object.hasOwn(manifest.files, relative)) failures.push(relative);
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
  }
  if (failures.length) throw Error(`已验收核心发生修改、删除或重命名：${failures.join(', ')}`);
  return { status: 'ok', source_commit: BASE_COMMIT, protected_files: Object.keys(manifest.files).length, line_endings: 'Git LF（仅兼容 CRLF 检出差异）', git_verified: verifyGit };
}
if (require.main === module) {
  try { console.log(JSON.stringify(checkFrozen({ verifyGit: process.argv.includes('--verify-git') }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkFrozen, protectedFile, digest, BASE_COMMIT };
