'use strict';
// Maintainer-only explicit inbox controller. Never chooses or retries a product.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js');
const { ROOT, readConfig } = require('./config.cjs');
const { withAcceptance } = require('../tools/acceptance-lock.cjs');
const { sanitize } = require('../scripts/recommendation-acceptance.cjs');
const { capture } = require('../scripts/capture-page-evidence.cjs');
async function main() {
  require('./check-frozen.cjs').checkFrozen();
  const label = process.argv[2];
  if (!/^[a-z0-9-]{1,60}$/.test(label || '')) throw Error('需要唯一验收批次名。');
  await withAcceptance(ROOT, async () => {
    const dir = path.join(ROOT, 'docs/dev/http', label), inbox = path.join(ROOT, 'work', label);
    fs.mkdirSync(path.dirname(dir), { recursive: true }); fs.mkdirSync(path.dirname(inbox), { recursive: true });
    fs.mkdirSync(dir); fs.mkdirSync(inbox);
    const config = readConfig(), browserConfig = require('../tools/config.cjs').browserConfig();
    const browser = await (await fetch(`${browserConfig.endpoint}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
    const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
    let commit = null; try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(); } catch {}
    const meta = { source_commit: commit, transport: 'streamable-http', browser: browser.Browser, interval_ms: 90000, manual_acceptance: 'pending', hashes: Object.fromEntries(['server.cjs', 'clis/pdd/_dom.cjs', 'clis/pdd/_adapter.cjs', 'http/server.cjs', 'http/backend.cjs', 'http/package-lock.json'].map(file => [file, sha(file)])) };
    const deployed = path.join(ROOT, 'runtime/http-deployment.local.json');
    if (fs.existsSync(deployed)) meta.gateway_source_commit = JSON.parse(fs.readFileSync(deployed)).source_commit;
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(meta, null, 2) + '\n');
    const transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: { Authorization: `Bearer ${config.token}` } }, reconnectionOptions: { maxRetries: 0 } });
    const client = new Client({ name: 'pinduoduo-reviewed-http-acceptance', version: '1' }, { capabilities: {} });
    let index = 0, searches = 0; const details = new Set(), skus = new Set();
    try {
      await client.connect(transport);
      console.log(JSON.stringify({ ready: true, label, inbox, evidence: dir }));
      while (true) {
        const file = path.join(inbox, `${index}.json`);
        if (!fs.existsSync(file)) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
        const input = JSON.parse(fs.readFileSync(file));
        if (input.close) break;
        if (!['pdd_status', 'pdd_search', 'pdd_read_item', 'pdd_read_sku'].includes(input.name)) throw Error('只允许状态、搜索、详情、规格。');
        const args = input.arguments || {};
        if (input.name === 'pdd_search' && (++searches > 3 || args.limit > 10)) throw Error('搜索额度超限。');
        if (input.name === 'pdd_read_item') details.add(args.url);
        if (input.name === 'pdd_read_sku') skus.add(args.goods_id);
        if (details.size > 6 || skus.size > 3) throw Error('商品额度超限。');
        const record = { ...meta, index, input, started_at: new Date().toISOString() };
        fs.writeFileSync(path.join(dir, `${index}-started.json`), JSON.stringify(record, null, 2));
        let result, data;
        try {
          result = await client.request({ method: 'tools/call', params: input }, CallToolResultSchema, { timeout: 300000, maxTotalTimeout: 300000 });
          data = result.structuredContent;
        } catch { data = { status: 'result_unknown', diagnostic: 'http_client_execution_unconfirmed' }; }
        record.finished_at = new Date().toISOString(); record.actual = sanitize(data);
        fs.writeFileSync(path.join(dir, `${index}.json`), JSON.stringify(record, null, 2));
        let imageIndex = 0;
        for (const block of result?.content || []) if (block.type === 'image') {
          const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[block.mimeType];
          if (ext) fs.writeFileSync(path.join(dir, `${index}-image-${imageIndex++}.${ext}`), Buffer.from(block.data, 'base64'));
        }
        if (input.name !== 'pdd_status') {
          try {
            const target = input.name === 'pdd_search' ? 'search_result.html' : data.goods_id || args.goods_id || require('../clis/pdd/_shared.cjs').goodsId(args.url);
            fs.writeFileSync(path.join(dir, `${index}-page.json`), JSON.stringify(await capture(target, browserConfig.endpoint), null, 2));
          } catch { fs.writeFileSync(path.join(dir, `${index}-page-unavailable.json`), JSON.stringify({ reason: 'narrow_page_evidence_unavailable' })); }
        }
        console.log(JSON.stringify({ index, status: data.status, diagnostic: data.diagnostic, goods_id: data.goods_id, images: imageIndex, record: path.join(dir, `${index}.json`) }));
        index++;
        if (data.status !== 'ok') { fs.writeFileSync(path.join(dir, 'STOPPED.json'), JSON.stringify({ status: data.status, diagnostic: data.diagnostic })); break; }
      }
    } finally { await transport.terminateSession().catch(() => {}); await client.close(); }
  });
}
if (require.main === module) main().catch(() => { console.error('HTTP 真机验收已停止；保留现场，不自动重试。请检查该批次记录。'); process.exitCode = 1; });
module.exports = { main };
