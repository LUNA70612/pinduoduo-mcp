'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
(async () => {
  const options = process.argv.slice(2);
  if (options.length && (options.length !== 2 || options[0] !== '--output')) throw Error('可选参数：--output 项目内证据文件路径');
  const output = path.resolve(root, options[1] || 'docs/dev/sdk-protocol-acceptance.json');
  if (!output.startsWith(root + path.sep)) throw Error('SDK证据必须保存在当前项目内。');
  const sdk = path.join(root, 'work', 'mcp-sdk-validation', 'node_modules', '@modelcontextprotocol', 'sdk');
  if (!fs.existsSync(sdk)) throw Error('先运行 npm install --prefix work/mcp-sdk-validation --ignore-scripts --no-package-lock --no-save @modelcontextprotocol/sdk@1.32.2；SDK 仅用于隔离验收。');
  const { Client } = await import(pathToFileURL(path.join(sdk, 'dist', 'esm', 'client', 'index.js')));
  const { StdioClientTransport } = await import(pathToFileURL(path.join(sdk, 'dist', 'esm', 'client', 'stdio.js')));
  const results = [];
  for (let run = 0; run < 2; run++) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'server.cjs')], env: { ...process.env, OPENCLI_CDP_ENDPOINT: 'http://127.0.0.1:65534', PDD_ENABLE_WRITES: '0', PDD_WRITE_TEST_MODE: '0' }, stderr: 'pipe' });
    const client = new Client({ name: 'pdd-official-sdk-acceptance', version: '1.0.0' }, { capabilities: {} });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.equal(tools.length, 10);
      assert.ok(tools.every(tool => tool.outputSchema && tool.annotations));
      const promptList=await client.listPrompts();
      assert.equal(promptList.prompts.length,3);
      const prompt=await client.getPrompt({name:'pdd_cat_food',arguments:{request:'200 元猫粮，先核验规格与营养资料'}});
      assert.equal(prompt.messages.length,2);
      const status = await client.callTool({ name: 'pdd_status', arguments: {} });
      assert.equal(status.structuredContent.status, 'ok');
      assert.equal(status.structuredContent.browser_connected, false);
      assert.equal(status.structuredContent.user_login_required, true);
      assert.equal(status.structuredContent.login_status, 'not_checked');
      assert.equal(status.structuredContent.login_policy, 'manual');
      assert.equal(status.structuredContent.operations.scope.current_ttl_ms, 1800000);
      assert.equal(typeof status.structuredContent.operations.history.total, 'number');
      assert.ok(tools.find(t => t.name === 'pdd_read_item').inputSchema.properties.include_product_images);
      assert.ok(tools.every(t => t.outputSchema.properties.waiting_for_user));
      const cursor = await client.callTool({ name: 'pdd_read_cart', arguments: { cursor: 'next' } });
      assert.equal(cursor.isError, true);
      assert.equal(cursor.structuredContent.status, 'unsupported');
      await assert.rejects(client.callTool({ name: 'pdd_read_item', arguments: { url: 'https://evil.test/?goods_id=1' } }), error => error.code === -32602);
      await client.ping();
      results.push({ run, tool_count: tools.length, prompt_count:promptList.prompts.length, prompts:'validated_by_sdk', schemas: 'validated_by_sdk', operation_scope:'current_and_history_separated', product_image_parameter:'present', disconnected_status: 'passed', login_status:'not_checked',login_policy:'manual',legacy_login_field:'preserved',cursor_business_error: 'passed', argument_rpc_error: 'passed', ping: 'passed' });
    } finally { await client.close(); }
  }
  const record = { date: new Date().toISOString(), sdk: '@modelcontextprotocol/sdk@1.32.2', transport: 'stdio', results, site_operations: false };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
