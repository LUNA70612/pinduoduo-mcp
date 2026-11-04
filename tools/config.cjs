'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
function browserConfig(env = process.env, root = ROOT) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(path.join(root, 'runtime', 'browser-config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('本地浏览器配置损坏，请检查 runtime/browser-config.json。'); }
  const endpoint = new URL(env.OPENCLI_CDP_ENDPOINT || (env.PDD_DEBUG_PORT ? `http://127.0.0.1:${env.PDD_DEBUG_PORT}` : saved.endpoint || 'http://127.0.0.1:9222'));
  if (!['http:', 'https:'].includes(endpoint.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw Error('CDP 地址必须是本机 http(s) 根地址，不接受凭证或远程主机。');
  const port = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('CDP 端口必须是 1024-65535 的整数。');
  if (env.PDD_DEBUG_PORT && Number(env.PDD_DEBUG_PORT) !== port) throw Error('PDD_DEBUG_PORT 与 OPENCLI_CDP_ENDPOINT 端口不一致。');
  return { endpoint: endpoint.origin, port, profile: path.resolve(root, env.PDD_BROWSER_PROFILE || saved.profile || path.join('runtime', 'browser-profile')), target: env.OPENCLI_CDP_TARGET || saved.target || '', browserPath: env.PDD_BROWSER_PATH || env.PDD_CHROME_PATH || saved.browserPath || '' };
}
function writeClientConfig(config, root = ROOT) {
  const result = { mcpServers: { pinduoduo: { command: process.execPath, args: [path.join(root, 'server.cjs')], env: { OPENCLI_CDP_ENDPOINT: config.endpoint, PDD_BROWSER_PROFILE: config.profile, ...(config.target ? { OPENCLI_CDP_TARGET: config.target } : {}), PDD_ENABLE_WRITES: '0' }, description: '拼多多 MCP：非商业软件，非官方 API；本机 Chrome/Edge、人工登录、默认只读。' } } };
  fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
  for (const name of ['mcp-config.generated.json', 'mcp-config.json']) fs.writeFileSync(path.join(root, 'outputs', name), JSON.stringify(result, null, 2) + '\n');
  const server=result.mcpServers.pinduoduo;
  const toml=['# 非商业软件，非官方 API。合并此片段，保留客户端现有配置。','[mcp_servers.pinduoduo]',`command = ${JSON.stringify(server.command)}`,`args = ${JSON.stringify(server.args)}`,'startup_timeout_sec = 30','tool_timeout_sec = 240','enabled = true','','[mcp_servers.pinduoduo.env]',...Object.entries(server.env).map(([key,value])=>`${key} = ${JSON.stringify(value)}`),''].join('\n');
  fs.writeFileSync(path.join(root,'outputs','codex-mcp.generated.toml'),toml);
  return result;
}
module.exports = { ROOT, browserConfig, writeClientConfig };
