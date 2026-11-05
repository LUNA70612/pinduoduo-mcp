'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../scripts/start-browser.cjs'), 'utf8');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const version = { Browser: 'Chrome/142.0.0.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/browser/test-browser' };

// Run the real launcher with controlled OS boundaries and virtual time. No browser
// or user profile is touched, including in timeout and occupied-port cases.
async function launch(options = {}) {
  let now = 0, sequence = 0;
  const timers = new Map(), calls = [], requests = [], output = [], errors = [], directories = [];
  const child = new EventEmitter();
  child.unref = () => {};
  const config = { endpoint: 'http://127.0.0.1:9444', port: 9444, profile: 'E:/isolated test/profile', browserPath: '', ...options.config };
  const processStub = { env: { LOCALAPPDATA: 'C:/Users/Example/AppData/Local', ...options.env }, stderr: { write: text => errors.push(text) }, exitCode: 0 };
  const schedule = (fn, ms = 0) => { const id = ++sequence; timers.set(id, { at: now + ms, fn }); return id; };
  const deps = {
    'node:fs': { existsSync: p => (options.files || [chrome]).includes(p), mkdirSync: p => directories.push(p) },
    'node:path': path,
    'node:child_process': { spawn: (...args) => {
      calls.push(args);
      queueMicrotask(() => {
        if (options.spawnError) child.emit('error', Object.assign(new Error('spawn failed'), { code: 'ENOENT' }));
        else { child.emit('spawn'); if (options.exitAfter !== undefined) schedule(() => child.emit('exit', options.exitCode ?? 1, null), options.exitAfter); }
      });
      return child;
    } },
    'node:net': { createConnection: () => {
      const socket = new EventEmitter();
      socket.setTimeout = () => socket;
      socket.destroy = () => {};
      queueMicrotask(() => options.busy ? socket.emit('connect') : socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })));
      return socket;
    } },
    '../tools/config.cjs': { browserConfig: () => config }
  };
  const context = {
    require: name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; },
    __dirname: path.join(__dirname, '../scripts'),
    process: processStub, URL,
    Date: class extends Date { static now() { return now; } },
    console: { log: (...args) => output.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')) },
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    AbortSignal: { timeout: ms => {
      const controller = new AbortController();
      controller.signal.budget = ms;
      schedule(() => controller.abort(), ms);
      return controller.signal;
    } },
    fetch: async (url, { signal }) => {
      requests.push({ url: String(url), budget: signal.budget, at: now });
      const response = options.response ? options.response(requests.length, now) : version;
      if (response === 'pending') return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('request timeout')), { once: true }));
      if (response === 'unreachable') throw Error('connection refused');
      if (response === 'invalid-json') return { ok: true, json: async () => { throw SyntaxError('not json'); } };
      return { ok: true, json: async () => response };
    }
  };
  let complete = false, failure;
  Promise.resolve(vm.runInNewContext(source, context)).catch(error => { failure = error; }).finally(() => { complete = true; });
  for (let step = 0; step < 200 && !complete; step++) {
    await new Promise(setImmediate);
    if (complete) break;
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    assert.ok(next, 'launcher left a pending operation without a timer');
    timers.delete(next[0]); now = next[1].at; next[1].fn();
  }
  if (failure) throw failure;
  assert.equal(complete, true, 'launcher must finish within its bounded budget');
  return { code: processStub.exitCode || 0, calls, requests, output: output.join('\n'), errors: errors.join('\n'), directories, elapsed: now };
}

test('browser success waits for valid CDP instead of just the spawn event', async () => {
  const result = await launch({ response: attempt => attempt < 3 ? 'unreachable' : version });
  assert.equal(result.code, 0);
  assert.equal(result.requests.length, 3);
  assert.equal(result.elapsed, 1000);
  assert.equal(result.calls.length, 1);
  assert.match(result.output, /CDP.*就绪/);
  assert.equal(result.requests[0].url, 'http://127.0.0.1:9444/json/version');
  assert.ok(result.calls[0][1].includes('--user-data-dir=E:/isolated test/profile'));
  assert.equal(result.calls[0][1].some(arg => arg.startsWith('--user-agent=')), false);
});

test('occupied browser port refuses to spawn or create a profile', async () => {
  const result = await launch({ busy: true });
  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.equal(result.directories.length, 0);
  assert.match(result.errors, /占用/);
  assert.match(result.errors, /bind-browser/);
});

test('unreachable CDP stops at 30 seconds without relaunching or killing a browser', async () => {
  const result = await launch({ response: () => 'unreachable' });
  assert.equal(result.code, 1);
  assert.equal(result.elapsed, 30000);
  assert.equal(result.calls.length, 1);
  assert.doesNotMatch(result.output, /就绪|Browser started/);
  assert.match(result.errors, /30.*秒|30000/);
});

test('individual CDP requests cannot exceed one second or the remaining deadline', async () => {
  const result = await launch({ response: attempt => attempt <= 2 ? 'unreachable' : 'pending' });
  assert.equal(result.code, 1);
  assert.equal(result.elapsed, 30000);
  assert.ok(result.requests.length > 1);
  for (const request of result.requests) assert.ok(request.budget > 0 && request.budget <= Math.min(1000, 30000 - request.at));
  assert.ok(result.requests.some(request => request.budget < 1000));
  assert.equal(result.calls.length, 1);
});

for (const response of [{}, { ...version, Browser: '' }, { ...version, webSocketDebuggerUrl: 'https://example.test/' }, { ...version, webSocketDebuggerUrl: 'ws://127.0.0.1:9555/devtools/browser/other' }, 'invalid-json']) {
  test(`invalid CDP response never reports readiness: ${JSON.stringify(response)}`, async () => {
    const result = await launch({ response: () => response });
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.output, /就绪|Browser started/);
    assert.equal(result.calls.length, 1);
  });
}

test('browser spawn failure reports a failed exit without a readiness message', async () => {
  const result = await launch({ spawnError: true });
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 0);
  assert.doesNotMatch(result.output, /就绪|Browser started/);
});

for (const exitCode of [0, 1]) {
  test(`browser exit before CDP readiness is not success: exit ${exitCode}`, async () => {
    const result = await launch({ response: () => 'pending', exitAfter: 100, exitCode });
    assert.equal(result.code, 1);
    assert.equal(result.elapsed, 100);
    assert.doesNotMatch(result.output, /就绪|Browser started/);
  });
}

for (const relative of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
  test(`user-level browser installation is discovered: ${relative}`, async () => {
    const browser = path.join('C:/Users/Example/AppData/Local', relative);
    const result = await launch({ files: [browser] });
    assert.equal(result.code, 0);
    assert.equal(result.calls[0][0], browser);
  });
}

test('explicit browser path remains first and an absent explicit path retains system fallback', async () => {
  const custom = 'E:/Browser/Application/chrome.exe';
  const explicit = await launch({ config: { browserPath: custom }, files: [custom, chrome] });
  assert.equal(explicit.calls[0][0], custom);
  const fallback = await launch({ config: { browserPath: custom }, files: [chrome] });
  assert.equal(fallback.calls[0][0], chrome);
});
