'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, setupConfig } = require('./config.cjs');
function setup() {
  require('./check-frozen.cjs').checkFrozen();
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('需要 Node.js 22 或以上。');
  if (!fs.existsSync(path.join(ROOT, 'node_modules/@jackwener/opencli/package.json'))) throw Error('请先运行 npm run setup 安装原服务，再安装可选 HTTP 入口。');
  const npmEntry = process.env.npm_execpath;
  if (!npmEntry || !fs.existsSync(npmEntry)) throw Error('请通过 npm run setup:http 启动安装器。');
  const result = spawnSync(process.execPath, [npmEntry, 'ci', '--prefix', path.join(ROOT, 'http'), '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(ROOT, '.cache/http-npm')], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw Error('HTTP 可选依赖安装失败；原 stdio 服务未改变。');
  console.log(JSON.stringify(setupConfig(), null, 2));
  console.log('启动：npm run start:http。原 Codex stdio 配置无需更改；HTTP 令牌只保存在本机连接资料中。');
}
if (require.main === module) { try { setup(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { setup };
