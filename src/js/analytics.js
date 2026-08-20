// Lightweight first-party visitor tracking -- no third-party script, no
// cookies beyond the existing session ones, no IP/fingerprint collection.
// visitorId is a random UUID generated client-side and kept in localStorage
// purely to distinguish "one visitor across several page loads" from
// "several different visitors" -- it carries no personal information on its
// own. If the visitor happens to be logged in, the backend separately
// attaches their real client record via the existing session cookie (see
// server/index.js's /api/analytics/beacon) -- this file never sends
// anything but the anonymous id, the current path, and the referrer.
const VISITOR_ID_KEY = 'lapanza-visitor-id';
const HEARTBEAT_MS = 45_000;

function getOrCreateVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    // Private-mode/blocked localStorage -- fall back to a per-page-load id
    // rather than not tracking at all; just won't dedupe across page loads.
    return crypto.randomUUID();
  }
}

function sendBeacon(payload) {
  const body = JSON.stringify(payload);
  // sendBeacon survives page unload/navigation and never blocks it -- the
  // right tool for "fire this and don't wait", falls back to a keepalive
  // fetch for browsers/paths where sendBeacon can't set a JSON content type.
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon('/api/analytics/beacon', blob)) return;
  }
  fetch('/api/analytics/beacon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    keepalive: true,
    body,
  }).catch(() => {
    /* best-effort -- a lost beacon never affects the actual page */
  });
}

export function trackVisit() {
  const visitorId = getOrCreateVisitorId();
  sendBeacon({ visitorId, path: location.pathname, referrer: document.referrer, type: 'pageview' });

  setInterval(() => {
    if (document.visibilityState !== 'visible') return; // don't count a backgrounded tab as "active"
    sendBeacon({ visitorId, path: location.pathname, type: 'heartbeat' });
  }, HEARTBEAT_MS);
}
