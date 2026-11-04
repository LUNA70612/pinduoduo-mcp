'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browserConfig, writeClientConfig } = require('../tools/config.cjs');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'work', 'test-deployment');
fs.mkdirSync(base, { recursive: true });
test('endpoint config rejects conflict, credentials and remote CDP; generated paths handle spaces', () => {
  const directory = fs.mkdtempSync(path.join(base, 'space path-'));
  assert.throws(() => browserConfig({ OPENCLI_CDP_ENDPOINT: 'http://remote.example:9222' }, directory));
  assert.throws(() => browserConfig({ OPENCLI_CDP_ENDPOINT: 'http://user:secret@localhost:9222' }, directory));
  assert.throws(() => browserConfig({ OPENCLI_CDP_ENDPOINT: 'http://localhost:9335', PDD_DEBUG_PORT: '9222' }, directory));
  const config = browserConfig({ PDD_DEBUG_PORT: '9335' }, directory);
  const generated = writeClientConfig(config, directory).mcpServers.pinduoduo;
  assert.equal(generated.env.OPENCLI_CDP_ENDPOINT, 'http://127.0.0.1:9335');
  assert.equal(generated.env.PDD_ENABLE_WRITES, '0');
  assert.equal(generated.args[0], path.join(directory, 'server.cjs'));
  assert.ok(generated.description.includes('非商业软件，非官方 API'));
});
test('generated Codex configuration uses TOML with sufficient tool timeout and leaves global config alone',()=>{
 const directory=fs.mkdtempSync(path.join(base,'codex path-'));writeClientConfig(browserConfig({PDD_DEBUG_PORT:'9335'},directory),directory);
 const file=path.join(directory,'outputs','codex-mcp.generated.toml');assert.equal(fs.existsSync(file),true);const text=fs.readFileSync(file,'utf8');assert.match(text,/\[mcp_servers\.pinduoduo\]/);assert.match(text,/tool_timeout_sec = 240/);assert.match(text,/PDD_ENABLE_WRITES = "0"/);assert.equal(text.includes('9335'),true);assert.equal(fs.existsSync(path.join(directory,'.codex')),false);
});
test('source release excludes private files and retains licenses and hashes', () => {
  const destination = fs.mkdtempSync(path.join(base, 'release-'));
  const entries = require('../scripts/release.cjs').copySource(root, destination);
  assert.ok(entries.some(item => item.path === 'LICENSE'));
  assert.ok(entries.some(item => item.path === 'third-party/OpenCLI-LICENSE-2.0.txt'));
  for (const name of ['runtime', 'state', '.cache', 'node_modules', 'work', 'outputs', '.git']) assert.equal(fs.existsSync(path.join(destination, name)), false);
  assert.ok(fs.existsSync(path.join(destination, 'MANIFEST.sha256')));
});

test('source distribution retains ignore rules and regression fixtures but excludes nested local artifacts', () => {
  const {copySource}=require('../scripts/release.cjs');
  const source=fs.mkdtempSync(path.join(base,'contaminated-source-'));
  copySource(root,source);
  const artifacts=['scripts/debug.log','tools/.env','tools/.env.local','tests/session.local.json','tests/scratch.tmp','tests/browser.key','tests/browser.pfx','tools/mcp-config.generated.json','tools/codex-mcp.generated.toml','tools/node_modules/dependency/index.js','tests/private/account.json','tests/__pycache__/fixture.pyc'];
  for(const name of artifacts){const file=path.join(source,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'local-only sentinel');}
  const destination=fs.mkdtempSync(path.join(base,'clean-source-'));
  const entries=copySource(source,destination);
  assert.ok(entries.some(item=>item.path==='.gitignore'));
  assert.ok(entries.some(item=>item.path==='tests/sku-first-item-secondary.test.cjs'));
  assert.ok(entries.some(item=>item.path==='tests/fixtures/pdd-kugou-first-item-subsidy-2026-11-04.json'));
  for(const name of artifacts)assert.equal(fs.existsSync(path.join(destination,name)),false,name);
});
test('live evidence cannot contain chat bubbles, cart contents, nickname or tokens', () => {
  const data = require('../scripts/live-acceptance.cjs').redact({ status: 'ok', messages: ['secret chat'], outgoing_messages: ['secret chat'], items: [{ title: 'private cart' }], nickname: 'private name', cookie: 'secret token' });
  assert.deepEqual(data, { status: 'ok', cart_item_count: 1, message_count: 1 });
});
