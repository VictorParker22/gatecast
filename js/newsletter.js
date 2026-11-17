// The newsletter signup (Buttondown): one calm line with an email field and a Subscribe button, posted straight to
// Buttondown's embed endpoint. No third-party script, no pixel: the browser sends the form only when the reader
// presses Subscribe, and Buttondown's own page confirms it. The username comes from data/site.json ("buttondown");
// while it is null (or not a plausible username) the form is not rendered at all, anywhere.
// Used by the front page (mounted into #newsletter from /data/site.json) and, server-side, by lib/weekly.js for the
// /weekly/ pages. Pure apart from mountNewsletter, so it is unit-tested with plain Node (tests/weekly.test.mjs).

export const BUTTONDOWN_EMBED = 'https://buttondown.com/api/emails/embed-subscribe/';
// Buttondown usernames are letters, digits, hyphens and underscores.
const USER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// The configured username, or null when the signup is off.
export function buttondownUser(config) {
  const u = config && typeof config.buttondown === 'string' ? config.buttondown.trim() : '';
  return USER.test(u) ? u : null;
}

export const signupAction = (user) => BUTTONDOWN_EMBED + encodeURIComponent(user);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// The form, or '' when the signup is off. id prefixes the element ids (two forms can share a page).
export function signupHTML(config, { id = 'newsletter' } = {}) {
  const user = buttondownUser(config);
  if (!user) return '';
  const p = esc(String(id).replace(/[^\w-]/g, '') || 'newsletter');
  return `<form class="grid max-w-read gap-2" action="${esc(signupAction(user))}" method="post" aria-labelledby="${p}-h">
  <h2 id="${p}-h" class="signage text-base/tight">The week’s picks by email</h2>
  <p class="text-sm text-np-muted">Once a week, the editor’s weird-news picks, each linked to the original. Buttondown sends it for us, with open and click tracking off. Unsubscribe any time.</p>
  <div class="flex flex-wrap items-end gap-2">
    <div class="field min-w-0 grow basis-64"><label for="${p}-email">Email address</label><input id="${p}-email" name="email" type="email" autocomplete="email" required class="min-h-tap w-full rounded-sm border-2 border-np-ink bg-np-field px-3 font-medium text-inherit hover:border-np-cobalt"></div>
    <input type="hidden" name="embed" value="1">
    <button class="btn btn--primary" type="submit">Subscribe</button>
  </div>
</form>`;
}

// The front page: read the switch from /data/site.json and fill root (kept hidden and empty when the signup is off
// or the file cannot be read). Never throws.
export async function mountNewsletter(root, { fetchImpl = globalThis.fetch, url = '/data/site.json' } = {}) {
  if (!root || typeof fetchImpl !== 'function') return false;
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return false;
    const html = signupHTML(await res.json(), { id: root.id || 'newsletter' });
    if (!html) return false;
    root.innerHTML = html;
    root.hidden = false;
    return true;
  } catch {
    return false;
  }
}

if (typeof document !== 'undefined') {
  const el = document.getElementById('newsletter');
  if (el) mountNewsletter(el);
}
