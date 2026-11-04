'use strict';
// Parse OpenCLI's `-f json` envelope without changing the returned shape.

function parse(stdout) {
  const invalid = message => Object.assign(new Error(message), { code: 'INVALID_OUTPUT' });
  if (!stdout || !stdout.trim()) throw invalid('OpenCLI 返回为空。');
  const text = stdout.trim();
  const start = text.search(/[[{]/);
  if (start < 0) throw invalid('OpenCLI 返回不是 JSON。');
  const json = text.slice(start);
  try {
    const v = JSON.parse(json);
    if (v && v.ok === false) {
      const error = v.error || {};
      const e = new Error(error.message || 'OpenCLI 执行失败。');
      e.code = error.code || 'OPENCLI_FAILED';
      e.details = error;
      throw e;
    }
    if (v && v.ok === true && Object.hasOwn(v, 'data')) return v.data;
    if (Array.isArray(v) || (v && typeof v === 'object')) return v;
    return v;
  } catch (error) {
    if (error && error.code && error.code !== 'SyntaxError') throw error;
    throw invalid('OpenCLI 返回无法解析为 JSON。');
  }
}

module.exports = { parse };
