'use strict';
// Browser session helper. Callers supply the connection check and launcher.

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
