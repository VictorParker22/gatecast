// Visit counts: Vercel Web Analytics (owner decision: cookieless page-view totals, no other counter). Loaded on the
// public pages (not review.html) only when the visitor has neither Do Not Track nor Global Privacy Control on: the same
// rule as the anonymous story-click totals (clickAllowed() in js/community.js), so one sentence on how.html covers
// every counter. The script is served by Vercel from Gatecast's own address once Web Analytics is enabled for the
// project; server.js answers the same path with an empty script locally, so nothing 404s in development.
import { clickAllowed } from './community.js';

export const SCRIPT_SRC = '/_vercel/insights/script.js';

// May this visit be counted? false under Do Not Track (navigator.doNotTrack, window.doNotTrack, msDoNotTrack) or
// Global Privacy Control (navigator.globalPrivacyControl === true).
export const analyticsAllowed = (nav = globalThis.navigator, win = globalThis) => clickAllowed(nav, win);

// Adds the script once, after Vercel's documented queue stub (window.va), when allowed. Returns whether it was added.
export function loadAnalytics({ doc = globalThis.document, nav = globalThis.navigator, win = globalThis } = {}) {
  try {
    if (!doc || !analyticsAllowed(nav, win)) return false;
    if ([...doc.scripts].some((s) => s.getAttribute('src') === SCRIPT_SRC)) return false;
    win.va = win.va || function va(...args) { (win.vaq = win.vaq || []).push(args); };
    const s = doc.createElement('script');
    s.defer = true;
    s.src = SCRIPT_SRC;
    s.onerror = () => s.remove(); // Web Analytics not enabled yet: nothing else depends on it
    (doc.head || doc.documentElement).appendChild(s);
    return true;
  } catch {
    return false;
  }
}

if (typeof document !== 'undefined') loadAnalytics();
