'use strict';

// Prepare a self-contained checkout without changing global npm or browser state.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const nodeMajor = Number(process.versions.node.split('.')[0]);

function fail(message) {
  console.error(`设置失败：${message}`);
  process.exit(1);
}

if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
  fail(`需要 Node.js >= 22，当前为 ${process.versions.node}。`);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmEntry = process.env.npm_execpath;
if (!npmEntry || !fs.existsSync(npmEntry)) fail('请使用 npm run setup 启动安装器。');
for (const arg of args) if (arg !== '--skip-install') fail(`未知参数：${arg}`);
function run(commandArgs) {
  const result = spawnSync(process.execPath, [npmEntry, ...commandArgs], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, npm_config_cache: path.join(root, '.cache', 'npm') },
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`命令退出码 ${result.status}：npm ${commandArgs.join(' ')}`);
}

fs.mkdirSync(path.join(root, '.cache', 'npm'), { recursive: true });
for (const dir of ['runtime', 'state', 'outputs']) fs.mkdirSync(path.join(root, dir), { recursive: true });

if (!args.has('--skip-install')) {
  console.log('安装锁定依赖（不会执行安装脚本）...');
  run(['ci', '--ignore-scripts']);
}
console.log('安装本地 OpenCLI 适配器...');
run(['run', 'install:adapters']);

const { browserConfig, writeClientConfig } = require('../tools/config.cjs');
writeClientConfig(browserConfig());
const generated = path.join(root, 'outputs', 'mcp-config.generated.json');

console.log('\n设置完成。非商业软件，非官方 API。');
console.log(`1. 启动隔离浏览器：${npm} run browser`);
console.log('2. 在浏览器中扫码登录拼多多。');
console.log(`3. 将 ${generated} 中的 pinduoduo 配置复制到 MCP 客户端。`);
console.log(`4. 检查连接：${npm} run live -- status`);
console.log('写操作保持关闭（PDD_ENABLE_WRITES=0）。');
