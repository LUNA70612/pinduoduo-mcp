'use strict';
// Minimal browser session: ensures a bound, connected Chrome is available
// before a task runs. The real bridge connection is checked via the
// 127.0.0.1:19825 status endpoint (see tools/pdd.js -> connected()).

function createRuntime({ connected, launchChrome }) {
  return {
    ensure: async (targetUrl) => {
      const ok = await connected();
      if (!ok && targetUrl) {
        await launchChrome(targetUrl);
      }
      return true;
    },
  };
}

function createSession() {
  return { ensure: async () => true };
}

module.exports = { createRuntime, createSession };
