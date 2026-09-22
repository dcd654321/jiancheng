'use strict';

// One bounded retry per cluster of connectivity events; never a background loop.
function createNetworkRecovery(wxApi, session, options = {}) {
  const now = options.now || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  let visible = false, disposed = false, timer = null, running = false;
  let pending = false, connected = null, lastRun = -Infinity;
  function allowed() {
    try {
      const s = session.status();
      return visible && !disposed && connected === true && s.configured && s.consented && !s.conflict;
    } catch (_) { return false; }
  }
  function cancel() { if (timer !== null) clearTimer(timer); timer = null; }
  function schedule() {
    if (!pending || !allowed() || running || timer !== null) return;
    timer = setTimer(async () => {
      timer = null;
      if (!allowed()) return;
      pending = false; running = true; lastRun = now();
      try { await session.recoverConnection(); }
      catch (_) { /* Session retains the error and durable queue for explicit retry. */ }
      finally { running = false; schedule(); }
    }, Math.max(300, 1500 - (now() - lastRun)));
  }
  const listener = event => {
    if (disposed || typeof event.isConnected !== 'boolean') return;
    connected = event.isConnected;
    session.setNetworkAvailable(connected);
    pending = connected;
    if (!connected) cancel();
    else schedule();
  };
  if (typeof wxApi.onNetworkStatusChange === 'function') wxApi.onNetworkStatusChange(listener);
  return {
    onShow() { visible = true; schedule(); },
    onHide() { visible = false; cancel(); },
    dispose() {
      disposed = true; visible = false; pending = false; cancel();
      if (typeof wxApi.offNetworkStatusChange === 'function') wxApi.offNetworkStatusChange(listener);
    }
  };
}

module.exports = { createNetworkRecovery };
