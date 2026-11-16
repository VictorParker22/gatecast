// Pure logic for the civic boxes on the Today page ("Your statehouse" and "Both sides"): query paths,
// the words and numbers each vote shows, and the order of a topic's statements. Shared with the reviewer console (js/reviewmodel.js). No DOM and no
// network, so it is unit-tested with plain Node. Everything shown is copied from the public record; nothing
// here rewrites a title or a quote.

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// A two-letter code we know, upper-cased, or null.
export function stateCode(s) {
  const c = typeof s === 'string' ? s.trim().toUpperCase() : '';
  return Object.hasOwn(STATE_NAMES, c) ? c : null;
}

/* ---------- Queries (PostgREST paths under /rest/v1/) ---------- */

export const VOTE_FIELDS = [
  'state', 'bill_identifier', 'bill_title', 'chamber', 'chamber_name', 'motion', 'voted_at', 'voted_on', 'passed',
  'yes', 'no', 'other', 'dem_yes', 'dem_no', 'dem_other', 'rep_yes', 'rep_no', 'rep_other',
  'oth_yes', 'oth_no', 'oth_other', 'party_unknown', 'record_url', 'openstates_url',
];

export function votesPath(state, limit = 6) {
  const c = stateCode(state);
  return c ? `state_votes?select=${VOTE_FIELDS.join(',')}&state=eq.${c}&order=voted_at.desc&limit=${limit}` : null;
}

// Published Both sides topics for the nation and, when known, the visitor's state.
export function topicsPath(state, limit = 2) {
  const c = stateCode(state);
  const place = c ? `place=in.(US,${c})` : 'place=eq.US';
  return `topics?select=*,statements(*)&status=eq.published&${place}&order=published_at.desc&limit=${limit}`;
}

/* ---------- Small formatters ---------- */

// Only http(s) links are ever put in an href.
export function safeUrl(u) {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

export function hostOf(u) {
  const s = safeUrl(u);
  return s ? new URL(s).hostname.replace(/^www\./, '') : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-11-10" or an ISO timestamp -> "10 Nov 2026". The date part is read as written (the collector stores the
// state's own calendar day), never shifted to the browser's zone.
export function fmtDate(s) {
  const m = typeof s === 'string' && s.match(/^(\d{4})-(\d\d)-(\d\d)/);
  if (!m || +m[2] < 1 || +m[2] > 12) return '';
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

const n0 = (x) => (Number.isFinite(+x) && +x > 0 ? Math.round(+x) : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "Ohio House", "California Assembly", "Nebraska Legislature" (one chamber). Uses the chamber's own name.
export function chamberLabel(row) {
  const state = STATE_NAMES[row?.state] || '';
  const fallback = { upper: 'Senate', lower: 'House', legislature: 'Legislature' }[row?.chamber] || '';
  const own = String(row?.chamber_name ?? '').trim() || fallback;
  if (!own) return state;
  return state && !own.toLowerCase().startsWith(state.toLowerCase()) ? `${state} ${own}` : own;
}

// "Democrats 11 yes · 21 no", with " · 2 not voting" only when someone was absent, excused or abstained.
export function partyLine(label, yes, no, other = 0) {
  const o = n0(other);
  return `${label} ${n0(yes)} yes · ${n0(no)} no${o ? ` · ${o} not voting` : ''}`;
}

/* ---------- One vote ---------- */

const PARTIES = [['dem', 'Democrats'], ['rep', 'Republicans']];

// Everything one vote shows, or null when the row lacks what the record needs (identifier, title, a link).
export function voteModel(row) {
  if (!row || typeof row !== 'object') return null;
  const bill = String(row.bill_identifier ?? '').trim();
  const title = String(row.bill_title ?? '').trim();
  const openstates = safeUrl(row.openstates_url);
  const record = safeUrl(row.record_url);
  if (!bill || !title || (!openstates && !record)) return null;

  const yes = n0(row.yes), no = n0(row.no), other = n0(row.other);
  const total = yes + no + other;
  const share = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  // A party row appears when at least one of its members is on the record for this vote. Bar widths are shares
  // of everyone recorded, so a smaller caucus draws a shorter bar.
  const parties = PARTIES.map(([k, label]) => {
    const y = n0(row[`${k}_yes`]), n = n0(row[`${k}_no`]), o = n0(row[`${k}_other`]);
    return { key: k, label, yes: y, no: n, other: o, text: partyLine(label, y, n, o), bar: { yes: share(y), no: share(n), other: share(o) } };
  }).filter((p) => p.yes + p.no + p.other > 0);

  const oy = n0(row.oth_yes), on = n0(row.oth_no), oo = n0(row.oth_other);
  const othersN = oy + on + oo;
  const others = othersN ? `+${plural(othersN, 'other', 'others')} (${oy} yes · ${on} no${oo ? ` · ${oo} not voting` : ''})` : null;
  const unknownN = n0(row.party_unknown);
  const unknown = unknownN ? `${plural(unknownN, 'vote', 'votes')} not matched to a party` : null;

  const links = [];
  if (record) links.push({ label: 'Official record', href: record });
  if (openstates) links.push({ label: 'Open States', href: openstates });

  const outcome = row.passed ? 'Passed' : 'Failed';
  const chamber = chamberLabel(row);
  // The motion as recorded, unless it only repeats the outcome ("Passed").
  const motion = String(row.motion ?? '').trim();
  const date = fmtDate(row.voted_on || row.voted_at);
  return {
    bill, title, chamber, date,
    motion: motion.toLowerCase() === outcome.toLowerCase() ? '' : motion,
    passed: !!row.passed, outcome,
    yes, no, other,
    tally: `${yes}–${no}`,
    tallyWords: `${yes} yes, ${no} no${other ? `, ${other} not voting` : ''}`,
    parties, others, unknown, links,
  };
}

export function votesModel(rows) {
  return (Array.isArray(rows) ? rows : []).map(voteModel).filter(Boolean);
}

/* ---------- Both sides ---------- */

export const SIDE_LABEL = { D: 'Democrat', R: 'Republican', other: 'Independent or other' };
const SIDE_ORDER = { D: 0, R: 1, other: 2 };

export function statementModel(s) {
  const href = safeUrl(s?.source_url);
  const quote = String(s?.quote ?? '').trim();
  const speaker = String(s?.speaker ?? '').trim();
  if (!href || !quote || !speaker || !Object.hasOwn(SIDE_LABEL, s?.side)) return null;
  return {
    id: s.id ?? null, side: s.side, sideLabel: SIDE_LABEL[s.side], speaker,
    role: String(s.role ?? '').trim(), quote, date: fmtDate(s.said_on), source: { href, host: hostOf(href) },
  };
}

// A published topic as shown to visitors: Democrat first, then Republican, then anyone else; each side in
// the order it was added. Null unless both sides are there (the database enforces this too).
export function topicModel(t) {
  if (!t || typeof t !== 'object') return null;
  const title = String(t.title ?? '').trim();
  const fact = String(t.neutral_fact ?? '').trim();
  const factHref = safeUrl(t.neutral_fact_source);
  if (!title || !fact || !factHref) return null;
  const statements = (Array.isArray(t.statements) ? t.statements : [])
    .map((s, i) => ({ s: statementModel(s), i, at: String(s?.created_at ?? '') }))
    .filter((x) => x.s)
    .sort((a, b) => SIDE_ORDER[a.s.side] - SIDE_ORDER[b.s.side] || a.at.localeCompare(b.at) || a.i - b.i)
    .map((x) => x.s);
  return {
    id: t.id ?? null, title, place: t.place === 'US' ? 'National' : STATE_NAMES[t.place] || String(t.place ?? ''),
    fact, factSource: { href: factHref, host: hostOf(factHref) }, date: fmtDate(t.published_at),
    statements, bothSides: statements.some((s) => s.side === 'D') && statements.some((s) => s.side === 'R'),
  };
}

export function topicsModel(rows) {
  return (Array.isArray(rows) ? rows : []).map(topicModel).filter((t) => t && t.bothSides);
}
