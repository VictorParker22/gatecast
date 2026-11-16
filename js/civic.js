// "Your statehouse" and "Both sides" on the Today page. Reads the public record that the Supabase project
// collects (floor votes from Open States) and the Both sides topics a reviewer has published. Shows nothing at
// all, not even a heading, when there is nothing to show or the request fails: no placeholders.
//
//   import { mountCivic } from './civic.js';
//   mountCivic(document.querySelector('#civic'), { state: 'OH' });   // state: two-letter US code, or null
//
// headingLevel (default 3) is the level of the "Your statehouse" and "Both sides" headings; each vote and topic
// title is one level below. Pass 2 when the section is not inside another h2.
//
// The container starts hidden and is only revealed once there is content. Resolves to true when something
// was shown. Styles: styles/civic.css. Words and numbers come from js/civicmodel.js (pure, unit-tested).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { esc } from './ui.js';
import { stateCode, STATE_NAMES, votesPath, topicsPath, votesModel, topicsModel } from './civicmodel.js';

const TIMEOUT_MS = 8000;

async function read(path) {
  if (!path) return [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const link = (l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}<span class="sr-only"> (opens in a new tab)</span></a>`;
const pct = (n) => `${Math.max(0, Math.min(100, n))}%`;

function voteHTML(v, i, h) {
  const id = `civic-vote-${i}`;
  return `<li class="civic-item vote">
    <h${h} class="vote__head" id="${id}"><span class="code vote__bill">${esc(v.bill)}</span> <span class="vote__title">${esc(v.title)}</span></h${h}>
    <p class="civic-meta">${esc(v.chamber)}${v.date ? ` · ${esc(v.date)}` : ''}${v.motion ? ` · <span class="vote__motion">${esc(v.motion)}</span>` : ''}</p>
    <p class="vote__result">
      <span class="vote__outcome${v.passed ? '' : ' vote__outcome--failed'} signage">${v.outcome}</span>
      <span class="num vote__tally" aria-hidden="true">${esc(v.tally)}</span><span class="sr-only">${esc(v.tallyWords)}</span>
      ${v.other ? `<span class="vote__other" aria-hidden="true">${v.other} not voting</span>` : ''}
    </p>
    ${v.parties.length ? `<ul class="split" aria-label="By party">${v.parties.map((p) => `<li class="split__row">
      <span class="split__text">${esc(p.text)}</span>
      <span class="split__bar" aria-hidden="true"><span class="split__yes" style="width:${pct(p.bar.yes)}"></span><span class="split__no" style="width:${pct(p.bar.no)}"></span><span class="split__away" style="width:${pct(p.bar.other)}"></span></span>
    </li>`).join('')}</ul>` : ''}
    ${v.others || v.unknown ? `<p class="civic-meta">${[v.others, v.unknown].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
    <p class="civic-links">${v.links.map(link).join('')}</p>
  </li>`;
}

function votesHTML(votes, state, h) {
  return `<section class="civic__block" aria-labelledby="civic-votes-title">
    <p class="civic__eyebrow">${esc(STATE_NAMES[state])}</p>
    <h${h} class="civic__title" id="civic-votes-title">Your statehouse</h${h}>
    <p class="civic__note">Floor votes from the public record via Open States. Gatecast adds no commentary.</p>
    <p class="split-key" aria-hidden="true"><span class="split-key__item"><span class="split__yes"></span>Yes</span><span class="split-key__item"><span class="split__no"></span>No</span><span class="split-key__item"><span class="split__away"></span>Not voting</span><span>Bar length: share of all recorded votes</span></p>
    <ol class="civic-list">${votes.map((v, i) => voteHTML(v, i, h + 1)).join('')}</ol>
  </section>`;
}

function statementHTML(s) {
  return `<li class="statement">
    <p class="statement__side signage">${esc(s.sideLabel)}</p>
    <p class="statement__who"><strong>${esc(s.speaker)}</strong>${s.role ? `<span class="civic-meta">${esc(s.role)}</span>` : ''}</p>
    <blockquote class="statement__quote"><p>${esc(s.quote)}</p></blockquote>
    <p class="civic-meta">${s.date ? `${esc(s.date)} · ` : ''}<a href="${esc(s.source.href)}" target="_blank" rel="noopener">Source: ${esc(s.source.host)}<span class="sr-only"> (opens in a new tab)</span></a></p>
  </li>`;
}

function topicHTML(t, i, h) {
  const id = `civic-topic-${i}`;
  return `<li class="civic-item topic">
    <p class="civic__eyebrow">${esc(t.place)}${t.date ? ` · ${esc(t.date)}` : ''}</p>
    <h${h} class="topic__title" id="${id}">${esc(t.title)}</h${h}>
    <p class="topic__fact">${esc(t.fact)} <a href="${esc(t.factSource.href)}" target="_blank" rel="noopener">Source: ${esc(t.factSource.host)}<span class="sr-only"> (opens in a new tab)</span></a></p>
    <ul class="statements">${t.statements.map(statementHTML).join('')}</ul>
  </li>`;
}

function topicsHTML(topics, h) {
  return `<section class="civic__block" aria-labelledby="civic-sides-title">
    <h${h} class="civic__title" id="civic-sides-title">Both sides</h${h}>
    <p class="civic__note">What each side said, quoted in full and dated, with the source. Checked by a person before it appears. Gatecast adds no commentary.</p>
    <ol class="civic-list">${topics.map((t, i) => topicHTML(t, i, h + 1)).join('')}</ol>
  </section>`;
}

export async function mountCivic(root, { state = null, headingLevel = 3 } = {}) {
  if (!root) return false;
  const h = Math.min(5, Math.max(2, Math.round(Number(headingLevel)) || 3));
  const code = stateCode(state);
  const req = String((Number(root.dataset.civicReq) || 0) + 1);
  root.dataset.civicReq = req;
  root.hidden = true;
  root.innerHTML = '';

  const [voteRows, topicRows] = await Promise.all([read(votesPath(code)), read(topicsPath(code))]);
  if (root.dataset.civicReq !== req) return false; // a newer call (another place) took over
  const votes = code ? votesModel(voteRows) : [];
  const topics = topicsModel(topicRows);
  if (!votes.length && !topics.length) return false;

  root.classList.add('civic');
  root.innerHTML = (votes.length ? votesHTML(votes, code, h) : '') + (topics.length ? topicsHTML(topics, h) : '');
  root.hidden = false;
  return true;
}
