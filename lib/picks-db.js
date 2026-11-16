// The editor's picks from the database (public.weird_picks, curated in the reviewer console), in the same shape
// as the items in data/weird-picks.json: { url, title, outlet, published, category, rating, note }.
// Read with the publishable key, which row-level security limits to published picks. No dependencies.
// Never throws: any failure (no key, network, timeout, bad reply) gives [], so the caller can fall back to the
// JSON file.

const TIMEOUT_MS = 5000;
const LIMIT = 200;
const CATEGORIES = ['people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other'];
const COLUMNS = 'url,title,outlet,published,category,rating,note';

const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function httpsUrl(v) {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' && u.hostname && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

// One database row -> one pick, or null when it lacks a link, a title or an outlet.
function toPick(row) {
  if (!row || typeof row !== 'object') return null;
  const url = httpsUrl(row.url);
  const title = text(row.title, 300);
  const outlet = text(row.outlet, 120);
  if (!url || !title || !outlet) return null;
  const published = typeof row.published === 'string' && /^\d{4}-\d\d-\d\d$/.test(row.published) ? row.published : null;
  const rating = Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5 ? row.rating : null;
  return {
    url, title, outlet, published,
    category: CATEGORIES.includes(row.category) ? row.category : 'other',
    rating,
    note: text(row.note, 200) || null,
  };
}

function picksEndpoint(base) {
  const root = String(base).replace(/\/+$/, '');
  return `${root}/rest/v1/weird_picks?select=${COLUMNS}&status=eq.published&order=published.desc.nullslast,updated_at.desc&limit=${LIMIT}`;
}

async function loadDbPicks({ url, key, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url) || typeof key !== 'string' || !key || typeof fetchImpl !== 'function') return [];
  const ctrl = new AbortController();
  let timer;
  // The deadline covers the whole read, body included, even if fetchImpl ignores the abort signal.
  const deadline = new Promise((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve([]); }, timeoutMs); });
  const work = (async () => {
    try {
      const res = await fetchImpl(picksEndpoint(url), { headers: { apikey: key, Accept: 'application/json' }, signal: ctrl.signal });
      if (!res || !res.ok) return [];
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      const seen = new Set();
      return rows.map(toPick).filter((p) => p && !seen.has(p.url) && seen.add(p.url));
    } catch {
      return [];
    }
  })();
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { loadDbPicks, toPick, picksEndpoint, CATEGORIES };
