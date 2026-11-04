'use strict';
// Browser guard: enforces a minimum cooldown between Taobao/PDD-style tasks
// (mirrors the safety model of chengkit-taobao) and provides a verification
// cooldown when a captcha/login wall is hit. Kept minimal but functional.

const VERIFICATION_COOLDOWN_MS = 90 * 1000;
const TASK_COOLDOWN_MS = 90 * 1000;

function createGuard({ interval = TASK_COOLDOWN_MS, now = Date.now, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let availableAt = 0;
  let queue = Promise.resolve();
  const waitUntil = async (target) => {
    const wait = Math.max(0, target - now());
    if (wait) await sleep(wait);
  };
  const guard = {
    run(kind, task) {
      const result = queue.then(async () => {
        await waitUntil(availableAt);
        availableAt = now() + interval;
        return task({ blockFor: guard.blockFor });
      });
      queue = result.catch(() => undefined);
      return result;
    },
    blockFor(ms) {
      availableAt = Math.max(availableAt, now() + Math.max(0, Number(ms) || 0));
    },
    readState() {
      const remaining = Math.max(0, availableAt - now());
      return { cooldown_ms: remaining, cooldown_seconds: Math.round(remaining / 1000) };
    },
  };
  return guard;
}

const defaultGuard = createGuard();
function readState() {
  const state = defaultGuard.readState();
  const remaining = state.cooldown_ms;
  return { cooldown_ms: remaining, cooldown_seconds: Math.round(remaining / 1000) };
}

const browserGuard = defaultGuard;

module.exports = { browserGuard, createGuard, VERIFICATION_COOLDOWN_MS, readState };
