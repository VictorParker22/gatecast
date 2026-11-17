// The editor's picks from the database (public.weird_picks, curated in the reviewer console), in the same shape
// as the items in data/weird-picks.json: { url, title, outlet, published, category, rating, note, videoId, imageUrl }.
// videoId and imageUrl are the editor's own media for the story (supabase/migrations/20261117150000_pick_media.sql):
// a YouTube id and a picture on the story's own site. lib/weird.js checks both again before anything is served.
// Read with the publishable key, which row-level security limits to published picks. No dependencies.
// Never throws: any failure (no key, network, timeout, bad reply) gives [], so the caller can fall back to the
// JSON file. Until the media migration is applied the database refuses the two new columns; the picks are then read
// without them (LEGACY_COLUMNS).

const TIMEOUT_MS = 5000;
const LIMIT = 200;
const CATEGORIES = ['people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other'];
const LEGACY_COLUMNS = 'url,title,outlet,published,category,rating,note';
const COLUMNS = `${LEGACY_COLUMNS},video_id,image_url`;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

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
    videoId: typeof row.video_id === 'string' && VIDEO_ID.test(row.video_id) ? row.video_id : null,
    imageUrl: typeof row.image_url === 'string' && row.image_url.length <= 2048 ? httpsUrl(row.image_url) : null,
  };
}

function picksEndpoint(base, columns = COLUMNS) {
  const root = String(base).replace(/\/+$/, '');
  return `${root}/rest/v1/weird_picks?select=${columns}&status=eq.published&order=published.desc.nullslast,updated_at.desc&limit=${LIMIT}`;
}
// PostgREST's answer when a selected column does not exist (or the visitor key may not read it): 400 with 42703, or
// 401/403 with 42501 for a column without a grant. Only then are the picks read again without the media columns.
const missingColumn = (status, body) => (status === 400 && body?.code === '42703') || ((status === 401 || status === 403) && body?.code === '42501') || body?.code === 'PGRST204';

async function loadDbPicks({ url, key, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url) || typeof key !== 'string' || !key || typeof fetchImpl !== 'function') return [];
  const ctrl = new AbortController();
  let timer;
  // The deadline covers the whole read, body included, even if fetchImpl ignores the abort signal.
  const deadline = new Promise((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve([]); }, timeoutMs); });
  const work = (async () => {
    try {
      const get = (columns) => fetchImpl(picksEndpoint(url, columns), { headers: { apikey: key, Accept: 'application/json' }, signal: ctrl.signal });
      let res = await get(COLUMNS);
      if (res && !res.ok) {
        const body = await res.json().catch(() => null);
        if (!missingColumn(res.status, body)) return [];
        res = await get(LEGACY_COLUMNS);
      }
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

module.exports = { loadDbPicks, toPick, picksEndpoint, CATEGORIES, COLUMNS, LEGACY_COLUMNS };
