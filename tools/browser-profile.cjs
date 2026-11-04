'use strict';
// Returns the OpenCLI browser profile/context alias to use.
const fs = require('node:fs');
const path = require('node:path');

function read() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'state', 'browser-profile.json'), 'utf8'));
    if (s && s.contextId) return s.contextId;
  } catch (_) { /* ignore */ }
  return process.env.PDD_PROFILE || 'default';
}

module.exports = { read };
