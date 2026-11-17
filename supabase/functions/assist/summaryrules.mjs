// The editor's summary of a pick ("In our words", weird_picks.summary): the house rules, as one pure module shared
// by the reviewer console (js/reviewmodel.js, the live checklist) and the reviewer assistant (the assist function's
// draft_summary re-checks every draft with it). The assist function cannot import from the site, so it deploys an
// identical copy, supabase/functions/assist/summaryrules.mjs; tests/summary.test.mjs checks the two files are the
// same byte for byte. No DOM, no network, no dependencies. Keep this file free of backslash-u escapes (a deploy tool
// mangles them): build such characters with String.fromCharCode.
//
// The rules (owner decision, 17 Nov 2026): 2 to 4 sentences in the editor's own words, at most 700 characters, and
// nothing that reads as copied: no run of 8 or more words in a row that is also in the outlet's headline, or in the
// story page when the assistant read it.

export const SUMMARY_MAX = 700;
export const SUMMARY_MIN_SENTENCES = 2;
export const SUMMARY_MAX_SENTENCES = 4;
export const COPY_RUN = 8;
export const SUMMARY_LABEL = 'Summary (your words, 2–4 sentences)';

const one = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const APOS = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x02bc, 0x0060) + "']", 'g');

// Words as they are compared: lower case, accents and apostrophes dropped, anything that is not a letter or digit
// a gap. "Moose’s bus-ride" -> ["mooses", "bus", "ride"].
export function words(s) {
  return String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(APOS, '')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Sentences: a full stop, question or exclamation mark (optionally followed by a closing quote or bracket), then
// space and a capital, a digit or an opening quote. Abbreviations such as "Mr." and "U.S." do not end a sentence.
const ABBR = /(?:\b(?:mr|mrs|ms|dr|st|mt|jr|sr|vs|etc|inc|ltd|co|no|approx|gov|sen|rep|lt|col|gen|sgt|capt|prof|ft)|\b[a-z])\.$/i;
export function sentences(text) {
  const s = one(text);
  if (!s) return [];
  const out = [];
  let start = 0;
  const re = /[.?!]+["')\]”’]*\s+(?=["'(“‘]?[\p{Lu}\p{N}])/gu;
  for (const m of s.matchAll(re)) {
    const end = m.index + m[0].trimEnd().length;
    const piece = s.slice(start, end);
    if (ABBR.test(piece.replace(/["')\]”’]+$/, ''))) continue;
    out.push(piece.trim());
    start = m.index + m[0].length;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// A run of COPY_RUN words as one key.
const gramKey = (ws, i, n = COPY_RUN) => ws.slice(i, i + n).join(' ');

// A short, stable hash of a key (FNV-1a, 32 bits, base 36), so the assistant can tell the console which runs of 8
// words a page holds without sending the page's text back.
export function hashKey(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// Every run of COPY_RUN words in a text, hashed: what draft_summary returns as page_grams. At most `max`.
export function gramHashes(text, max = 20000) {
  const ws = words(text);
  const out = new Set();
  for (let i = 0; i + COPY_RUN <= ws.length && out.size < max; i++) out.add(hashKey(gramKey(ws, i)));
  return [...out];
}

// The longest run of words in a row that `text` shares with a source, given as its words (a string) or as the set of
// its hashed 8-word runs (from gramHashes). Only runs of COPY_RUN words or more are found.
//   -> { words: n, phrase: '<the summary’s own words>' } (0 and '' when there is none)
export function sharedRun(text, source) {
  const ws = words(text);
  if (ws.length < COPY_RUN || !source) return { words: 0, phrase: '' };
  let has;
  if (typeof source === 'string') {
    const src = words(source);
    const set = new Set();
    for (let i = 0; i + COPY_RUN <= src.length; i++) set.add(gramKey(src, i));
    has = (k) => set.has(k);
  } else {
    const set = source instanceof Set ? source : new Set(Array.isArray(source) ? source : []);
    has = (k) => set.has(hashKey(k));
  }
  let best = 0, bestAt = 0, runAt = -1, runLen = 0;
  for (let i = 0; i + COPY_RUN <= ws.length; i++) {
    if (has(gramKey(ws, i))) {
      if (runAt >= 0 && i === runAt + runLen - COPY_RUN + 1) runLen++;
      else { runAt = i; runLen = COPY_RUN; }
      if (runLen > best) { best = runLen; bestAt = runAt; }
    } else { runAt = -1; runLen = 0; }
  }
  return best ? { words: best, phrase: ws.slice(bestAt, bestAt + best).join(' ') } : { words: 0, phrase: '' };
}

// The live checklist and the server's re-check. ctx: { title, page (text), pageGrams (hashed runs), notes }.
// Each check is { id, ok, hard, label, detail }. Hard rules block saving (console) or drop a draft (assist).
export function summaryChecks(text, { title = '', page = '', pageGrams = null, notes = '' } = {}) {
  const s = one(text);
  const n = [...s].length;
  const count = sentences(s).length;
  const fromTitle = sharedRun(s, title);
  const fromPage = page ? sharedRun(s, page) : pageGrams ? sharedRun(s, pageGrams) : { words: 0, phrase: '' };
  const fromNotes = notes ? sharedRun(s, notes) : { words: 0, phrase: '' };
  const quote = (r) => (r.words ? `Found: “${r.phrase}”` : '');
  const out = [
    { id: 'length', hard: true, ok: n <= SUMMARY_MAX, label: `At most ${SUMMARY_MAX} characters`, detail: `${n} / ${SUMMARY_MAX}` },
    { id: 'sentences', hard: true, ok: !s || (count >= SUMMARY_MIN_SENTENCES && count <= SUMMARY_MAX_SENTENCES), label: `${SUMMARY_MIN_SENTENCES} to ${SUMMARY_MAX_SENTENCES} sentences`, detail: s ? `${count} found` : '' },
    { id: 'headline', hard: true, ok: fromTitle.words < COPY_RUN, label: `Your own words: no run of ${COPY_RUN}+ words from the headline`, detail: quote(fromTitle) },
    { id: 'page', hard: true, ok: fromPage.words < COPY_RUN, label: page || pageGrams ? `No run of ${COPY_RUN}+ words from the story page` : `No run of ${COPY_RUN}+ words from the story page (checked when Claude reads it)`, detail: quote(fromPage) },
  ];
  if (notes) out.push({ id: 'notes', hard: true, ok: fromNotes.words < COPY_RUN, label: `No run of ${COPY_RUN}+ words from your notes (notes are facts, not text to copy)`, detail: quote(fromNotes) });
  out.push(
    { id: 'stop', hard: false, ok: !s || /[.?!]["')\]”’]*$/.test(s), label: 'Ends with a full stop', detail: '' },
    { id: 'calm', hard: false, ok: !/!/.test(s), label: 'Calm and neutral: no exclamation marks', detail: '' },
  );
  return out;
}

// The hard rules only, as codes (empty when the summary may be shown or saved): too_long, sentences,
// copied_headline, copied_page, copied_notes, empty.
export function summaryProblems(text, ctx = {}) {
  if (!one(text)) return ['empty'];
  const code = { length: 'too_long', sentences: 'sentences', headline: 'copied_headline', page: 'copied_page', notes: 'copied_notes' };
  return summaryChecks(text, ctx).filter((c) => c.hard && !c.ok).map((c) => code[c.id]);
}
