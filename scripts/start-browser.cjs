'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('../tools/config.cjs').browserConfig();
const candidates = [config.browserPath, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const browser = candidates.find(fs.existsSync);
if (!browser) throw new Error('未找到 Chrome/Edge，请设置 PDD_BROWSER_PATH。');
const root = path.join(__dirname, '..');
const profile = config.profile;
const port = config.port;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PDD_DEBUG_PORT 必须是 1024-65535 的整数。');
fs.mkdirSync(profile, { recursive: true });
const args = [`--remote-debugging-port=${port}`, '--remote-allow-origins=*', '--window-size=390,844', `--user-data-dir=${profile}`, 'https://mobile.yangkeduo.com/'];
// Preserve the browser's native desktop UA. Do not restore the old mobile override.
const child = spawn(browser, args, { detached: true, stdio: 'ignore', windowsHide: false });
child.once('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
child.once('spawn', () => { child.unref(); console.log(`Browser started: ${path.basename(browser)} port=${port} profile=${profile}`); });
