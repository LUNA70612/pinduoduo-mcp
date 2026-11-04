'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, browserConfig, writeClientConfig } = require('../tools/config.cjs');

(async () => {
  const config = browserConfig();
  const endpoint = config.endpoint, url = new URL(endpoint);
  const response = await fetch(new URL('/json/version', url), { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw Error(`CDP 返回 HTTP ${response.status}。`);
  const version = await response.json();
  if (typeof version.webSocketDebuggerUrl !== 'string') throw Error('CDP 未返回 webSocketDebuggerUrl。');
  const tabsResponse = await fetch(new URL('/json/list', url), { signal: AbortSignal.timeout(3000) });
  if (!tabsResponse.ok) throw Error('无法读取 CDP 标签清单。');
  const tabs = await tabsResponse.json();
  const pages = tabs.filter(tab => tab.type === 'page');
  if (config.target && !pages.some(tab => [tab.id, tab.title, tab.url].some(value => String(value || '').includes(config.target)))) throw Error('指定目标标签未找到，请检查 OPENCLI_CDP_TARGET。');
  fs.mkdirSync(path.join(ROOT, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'runtime', 'browser-config.json'), JSON.stringify(config, null, 2) + '\n');
  writeClientConfig(config);
  console.log(JSON.stringify({ status: 'browser_connected', endpoint, page_count: pages.length, browser: version.Browser || null, user_agent: version['User-Agent'] || null, profile: config.profile, note: '非商业软件，非官方 API。已保存本机绑定并生成客户端配置；连接不代表已登录。' }));
})().catch(error => { console.error(`浏览器绑定失败：${error.message}`); process.exit(1); });
