'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pdd = require('../tools/pdd.cjs');
const { ROOT } = require('../clis/pdd/_shared.cjs');
const action = process.argv[2] || 'resume';
if (!['resume', 'search', 'status'].includes(action)) throw Error('live 仅支持 status/resume/search，不提供自动写验收。');
(async () => {
  let record;
  try {
    const result = action === 'status' ? { browser_connected: await pdd.connected() } : action === 'resume' ? await pdd.resume() : await pdd.search({ query: process.argv[3] || '蓝牙耳机', limit: 1 });
    record = { date: new Date().toISOString(), action, status: result.status || 'ok', logged_in: result.logged_in ?? null, browser_connected: result.browser_connected ?? null, count: result.count ?? null, real_business_accepted: false };
  } catch (e) { record = { date: new Date().toISOString(), action, status: 'error', code: e.code || 'FAILED', real_business_accepted: false }; process.exitCode = 1; }
  const dir = path.join(ROOT, 'docs', 'dev'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `live-${action}.json`), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record));
})();
