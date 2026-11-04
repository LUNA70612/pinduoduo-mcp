'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const types = require('@modelcontextprotocol/sdk/types.js');
const { ROOT, readConfig } = require('./config.cjs');
const { createCoreBackend } = require('./backend.cjs');

const routes = [
  [types.ListToolsRequestSchema, types.ListToolsResultSchema],
  [types.CallToolRequestSchema, types.CallToolResultSchema],
  [types.ListPromptsRequestSchema, types.ListPromptsResultSchema],
  [types.GetPromptRequestSchema, types.GetPromptResultSchema],
  [types.PingRequestSchema, types.EmptyResultSchema],
];
const requestKey = id => JSON.stringify([typeof id, id]);
const gatewayError = message => Object.assign(new types.McpError(-32000, message), { gatewayRejection: true });
function reply(res, status, message, id = null, code = -32000) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
}
function authorized(value, token) {
  if (typeof value !== 'string') return false;
  const supplied = Buffer.from(value), expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
async function bodyOf(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') throw Object.assign(Error('需要 application/json。'), { httpStatus: 415 });
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1048576) throw Object.assign(Error('请求内容超过限制。'), { httpStatus: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(Error('无效 JSON。'), { httpStatus: 400, rpcCode: -32700 }); }
}
async function createGateway({ root = ROOT, config = readConfig({ root }), env = process.env, backendFactory = createCoreBackend, now = Date.now, log = () => {} } = {}) {
  if (config.host !== '127.0.0.1' || !/^[A-Za-z0-9_-]{43,128}$/.test(config.token || '')) throw Error('HTTP 仅支持回环地址和有效的本机令牌。');
  const sessions = new Map(), allSessions = new Set();
  let stopping = false;
  const event = (name, data = {}) => { try { log({ event: name, ...data }); } catch {} };
  async function closeSession(session) {
    if (session.closePromise) return session.closePromise;
    session.closing = true;
    if (session.id) sessions.delete(session.id);
    session.closePromise = (async () => {
      await session.ready;
      await Promise.allSettled([...session.pending]);
      await session.backend?.waitIdle();
      await session.front?.close().catch(() => {});
      await session.backend?.close().catch(() => {});
      allSessions.delete(session);
      event('session_closed');
    })();
    return session.closePromise;
  }
  async function newSession() {
    let finishInitialization;
    const session = { pending: new Set(), inFlight: new Map(), lastSeen: now(), blocked: false, closing: false, initializing: true, ready: new Promise(resolve => { finishInitialization = resolve; }) };
    allSessions.add(session);
    const onFault = reason => { session.blocked = true; event('core_unavailable', { reason }); };
    try {
      session.backend = await backendFactory({ root, env, onFault });
      if (session.closing || stopping) throw gatewayError('HTTP 服务正在停止。');
      const front = new Server(session.backend.info, { capabilities: session.backend.capabilities, instructions: session.backend.instructions });
      session.front = front;
      for (const [schema, resultSchema] of routes) front.setRequestHandler(schema, async (request, extra) => {
        const key = requestKey(extra.requestId), tracked = session.inFlight.get(key);
        if (tracked) tracked.forwarded = true;
        let pending;
        try {
          if (session.closing) throw gatewayError('HTTP 会话正在关闭，请等待原调用结束。');
          if (request.method === 'tools/call') {
            if (session.blocked && request.params.name !== 'pdd_status') throw gatewayError('原调用结果未确认或服务已断开；已停止派发，不会自动重试。请检查状态并重新建立搜索来源。');
            if (session.pageBusy && request.params.name !== 'pdd_status') throw gatewayError('当前会话已有页面调用执行中；请等待结束，按步骤串行调用。');
          }
          const pageCall = request.method === 'tools/call' && request.params.name !== 'pdd_status';
          if (pageCall) session.pageBusy = true;
          pending = session.backend.request(request, resultSchema, { timeout: config.requestTimeout, maxTotalTimeout: config.requestTimeout });
          session.pending.add(pending);
          try { return await pending; }
          finally { if (pageCall) session.pageBusy = false; }
        } catch (error) {
          if (error.gatewayRejection) throw error;
          if (!(error instanceof types.McpError) || [types.ErrorCode.RequestTimeout, types.ErrorCode.ConnectionClosed].includes(error.code)) {
            session.blocked = true;
            event('core_call_unconfirmed', { method: request.method, reason: error.code === types.ErrorCode.RequestTimeout ? 'timeout' : 'disconnected_or_protocol_error' });
            throw new types.McpError(-32000, '原服务调用未获得可确认结果；已暂停派发，不会自动重放。');
          }
          throw error;
        } finally {
          if (pending) session.pending.delete(pending);
          session.inFlight.delete(key); session.lastSeen = now();
        }
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: id => { if (session.closing || stopping) throw gatewayError('HTTP 服务正在停止。'); session.id = id; sessions.set(id, session); event('session_opened'); },
        onsessionclosed: () => { void closeSession(session); },
      });
      session.transport = transport;
      front.onerror = () => event('http_protocol_error');
      await front.connect(transport);
      session.initializing = false; finishInitialization();
      return session;
    } catch (error) { session.initializing = false; finishInitialization(); await closeSession(session); throw error; }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const port = server.address()?.port ?? config.port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(req.headers.host)) return reply(res, 403, '不允许的 Host。');
    if (req.headers.origin && !allowedHosts.map(host => `http://${host}`).includes(req.headers.origin)) return reply(res, 403, '不允许的 Origin。');
    if (!authorized(req.headers.authorization, config.token)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="pinduoduo-local-mcp"');
      return reply(res, 401, '需要本机 HTTP Bearer 令牌。');
    }
    if (req.url !== '/mcp') return reply(res, 404, '仅提供 /mcp。');
    if (!['POST', 'GET', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'POST, GET, DELETE'); return reply(res, 405, '不支持的 HTTP 方法。'); }
    if (stopping) return reply(res, 503, 'HTTP 服务正在停止。');
    let session;
    try {
      const message = req.method === 'POST' ? await bodyOf(req) : undefined;
      const sessionId = req.headers['mcp-session-id'];
      if (sessionId) {
        session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
        if (!session || session.closing) return reply(res, 404, 'HTTP 会话已结束；请重新初始化，并显式重新搜索。');
        if (now() - session.lastSeen >= config.idleTimeout && !session.pending.size && !session.backend.isExecuting()) {
          void closeSession(session); return reply(res, 404, 'HTTP 会话已过期；请重新初始化并搜索。');
        }
      } else {
        if (req.method !== 'POST' || !types.isInitializeRequest(message)) return reply(res, 400, '请先 initialize 建立 HTTP 会话。');
        if (allSessions.size >= 4) return reply(res, 503, '本机 HTTP 会话已达上限，请先关闭空闲连接。');
        session = await newSession();
      }
      session.lastSeen = now();
      if (message && Object.hasOwn(message, 'id')) {
        const key = requestKey(message.id);
        if (session.inFlight.has(key)) return reply(res, 409, '相同请求仍在执行；不会重复派发。', message.id);
        const tracked = { forwarded: false }; session.inFlight.set(key, tracked);
        const clearUnforwarded = () => { if (!tracked.forwarded) session.inFlight.delete(key); };
        res.once('finish', clearUnforwarded); res.once('close', clearUnforwarded);
      }
      await session.transport.handleRequest(req, res, message);
      if (!session.id) await closeSession(session);
    } catch (error) {
      reply(res, error.httpStatus || 500, error.httpStatus ? error.message : 'HTTP 适配层处理失败；请检查本机服务状态。', null, error.rpcCode || -32000);
      if (session && !session.id) await closeSession(session);
      event('http_request_failed', { status: error.httpStatus || 500 });
    }
  });
  server.requestTimeout = config.requestTimeout + 30000;
  server.headersTimeout = 60000;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  async function sweep() {
    for (const session of allSessions) if (!session.initializing && !session.closing && !session.pending.size && !session.backend.isExecuting() && now() - session.lastSeen >= config.idleTimeout) await closeSession(session);
  }
  const timer = setInterval(() => { void sweep(); }, 60000); timer.unref();
  return {
    server, sessions, allSessions, sweep,
    async listen() {
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); }); }
      catch (error) { clearInterval(timer); if (error.code === 'EADDRINUSE') throw Error(`HTTP 端口 ${config.port} 已占用；不会自动更换端口。`); throw Error('本机 HTTP 监听失败。'); }
      const address = server.address(); return { url: `http://127.0.0.1:${address.port}/mcp`, port: address.port };
    },
    async close() {
      stopping = true; clearInterval(timer);
      const stopped = new Promise(resolve => server.listening ? server.close(resolve) : resolve());
      await Promise.allSettled([...allSessions].map(closeSession));
      server.closeIdleConnections(); await stopped;
    },
  };
}
async function main() {
  require('./check-frozen.cjs').checkFrozen();
  const config = readConfig();
  const gateway = await createGateway({ config, log: entry => console.error(JSON.stringify({ time: new Date().toISOString(), ...entry })) });
  const binding = await gateway.listen();
  console.error(JSON.stringify({ status: 'listening', url: binding.url, transport: 'streamable-http', writes_enabled: false, connection_file: config.files.connection }));
  let quitting = false;
  const quit = async () => { if (quitting) return; quitting = true; await gateway.close(); };
  process.once('SIGINT', quit); process.once('SIGTERM', quit);
}
if (require.main === module) main().catch(error => { console.error(`HTTP 启动失败：${error.message} 原 stdio 配置未改变。`); process.exitCode = 1; });
module.exports = { createGateway };
