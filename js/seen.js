// Where "what changed since you last looked" keeps its notes: one localStorage entry on this device only,
// { places: { key: entry }, brief: { key: entry }, trips: { key: entry } }, pruned to the last week on every write.
// What goes in each entry is decided by js/changes.js. Without storage nothing is compared and nothing is shown.
import { store } from './shell.js';
import { prune } from './changes.js';

const SEEN = 'gatecast:seen';
const all = () => { const v = store.get(SEEN, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };

export function seenGet(part, key) {
  const p = all()[part];
  return p && typeof p === 'object' ? p[key] ?? null : null;
}
export function seenSet(part, key, entry) {
  const v = all();
  v[part] = prune({ ...(v[part] && typeof v[part] === 'object' ? v[part] : {}), [key]: entry }, Date.now());
  store.set(SEEN, v);
}
