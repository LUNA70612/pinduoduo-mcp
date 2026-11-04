'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../clis/pdd/_shared.cjs');
const folder = path.join(ROOT, 'state', 'browser.lock');
const ownerFile = path.join(folder, 'owner.json');
if (!fs.existsSync(folder)) { console.log('No browser lock.'); process.exit(0); }
const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
if (!Number.isInteger(owner.pid)) throw Error('锁拥有者信息无效，需要人工检查。');
try { process.kill(owner.pid, 0); throw Error('锁拥有者仍在运行，拒绝解锁。'); }
catch (e) { if (e.code !== 'ESRCH') throw e; }
fs.unlinkSync(ownerFile); fs.rmdirSync(folder);
console.log('Removed stale lock; request journals retained. Check any unknown write manually.');
