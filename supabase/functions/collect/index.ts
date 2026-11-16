// Collector: statehouse votes from Open States into public.state_votes.
//
// Runs inside Supabase, where the Open States key is stored as a secret.
// It copies the public record only: official title, counts, party split,
// date and links. It writes nothing of its own.
//
// It can be called with the public key, so it protects itself:
//   - at most one run every 5 minutes
//   - at most 8 Open States requests per run and 400 per day
//   - the reply holds counts only
//
// GET /functions/v1/collect            the 4 states collected longest ago
// GET /functions/v1/collect?states=OH,NJ

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OS_KEY = Deno.env.get('Open-States') ?? '';

const MIN_GAP_MS = 5 * 60 * 1000;
const RUN_BUDGET = 8;
const DAY_BUDGET = 400;
const SPACING_MS = 2000;
const MAX_AGE_DAYS = 120;
const SEATS_MAX_AGE_MS = 30 * 864e5;
const FLOOR_SHARE = 0.6; // a floor vote is one cast by at least this share of the chamber

const E = 'America/New_York', C = 'America/Chicago', M = 'America/Denver', P = 'America/Los_Angeles';
const STATES: Record<string, [string, string]> = {
  AL: ['Alabama', C], AK: ['Alaska', 'America/Anchorage'], AZ: ['Arizona', 'America/Phoenix'], AR: ['Arkansas', C],
  CA: ['California', P], CO: ['Colorado', M], CT: ['Connecticut', E], DE: ['Delaware', E], FL: ['Florida', E],
  GA: ['Georgia', E], HI: ['Hawaii', 'Pacific/Honolulu'], ID: ['Idaho', M], IL: ['Illinois', C], IN: ['Indiana', E],
  IA: ['Iowa', C], KS: ['Kansas', C], KY: ['Kentucky', E], LA: ['Louisiana', C], ME: ['Maine', E], MD: ['Maryland', E],
  MA: ['Massachusetts', E], MI: ['Michigan', E], MN: ['Minnesota', C], MS: ['Mississippi', C], MO: ['Missouri', C],
  MT: ['Montana', M], NE: ['Nebraska', C], NV: ['Nevada', P], NH: ['New Hampshire', E], NJ: ['New Jersey', E],
  NM: ['New Mexico', M], NY: ['New York', E], NC: ['North Carolina', E], ND: ['North Dakota', C], OH: ['Ohio', E],
  OK: ['Oklahoma', C], OR: ['Oregon', P], PA: ['Pennsylvania', E], RI: ['Rhode Island', E], SC: ['South Carolina', E],
  SD: ['South Dakota', C], TN: ['Tennessee', C], TX: ['Texas', C], UT: ['Utah', M], VT: ['Vermont', E],
  VA: ['Virginia', E], WA: ['Washington', P], WV: ['West Virginia', E], WI: ['Wisconsin', C], WY: ['Wyoming', M],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`database ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json().catch(() => null);
}

let used = 0;
class Stop extends Error {}

async function openStates(path: string) {
  if (used >= RUN_BUDGET) throw new Stop('run budget reached');
  if (used) await sleep(SPACING_MS);
  used++;
  const r = await fetch(`https://v3.openstates.org/${path}`, { headers: { 'X-API-KEY': OS_KEY } });
  if (r.status === 429) throw new Stop('Open States asked us to slow down');
  if (!r.ok) throw new Error(`Open States ${r.status}`);
  return r.json();
}

const dayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
const isHttp = (u: unknown) => typeof u === 'string' && /^https?:\/\//.test(u);
const CEREMONIAL = new Set(['resolution', 'concurrent resolution', 'memorial', 'commemoration', 'proclamation']);
const PROCEDURAL = /motion to|suspend|adjourn|recess|previous question|reconsider|\btable\b|\bamendment\b/i;

function party(p: string | null | undefined) {
  if (!p) return null;
  if (/^democrat/i.test(p)) return 'dem';
  if (/^republican/i.test(p)) return 'rep';
  return 'oth';
}

function rowsFor(state: string, bills: any[], seats: { upper: number | null; lower: number | null }) {
  const [, tz] = STATES[state];
  const fmt = dayIn(tz);
  const oldest = Date.now() - MAX_AGE_DAYS * 864e5;
  const rows = new Map<string, Record<string, unknown>>();
  let seen = 0;
  // Why votes were left out, so a state with nothing to show can be told apart from a filter that is wrong.
  const dropped: Record<string, number> = {};
  const drop = (why: string) => { dropped[why] = (dropped[why] ?? 0) + 1; };

  for (const b of bills) {
    const kinds: string[] = b.classification ?? [];
    const nVotes = (b.votes ?? []).length;
    if (kinds.length && kinds.every((k) => CEREMONIAL.has(k))) { seen += nVotes; dropped.ceremonial = (dropped.ceremonial ?? 0) + nVotes; continue; }
    if (!b.identifier || !b.title || !isHttp(b.openstates_url)) { seen += nVotes; dropped.incomplete = (dropped.incomplete ?? 0) + nVotes; continue; }

    for (const v of b.votes ?? []) {
      seen++;
      const chamber = v.organization?.classification;
      if (!['upper', 'lower', 'legislature'].includes(chamber)) { drop('not_a_chamber'); continue; }
      const size = chamber === 'lower' ? seats.lower : seats.upper;
      const voters: any[] = v.votes ?? [];
      if (!size) { drop('no_seat_count'); continue; }
      if (!voters.length) { drop('no_names_on_record'); continue; }
      if (voters.length < FLOOR_SHARE * size) { drop('committee_sized'); continue; }

      const cls: string[] = v.motion_classification ?? [];
      const motion = String(v.motion_text ?? '').trim();
      if (cls.length ? !cls.includes('passage') : PROCEDURAL.test(motion)) { drop('not_a_passage_vote'); continue; }

      const at = new Date(v.start_date);
      if (!v.id || !motion || Number.isNaN(+at) || +at > Date.now() + 864e5) { drop('incomplete'); continue; }
      if (+at < oldest) { drop('older_than_120_days'); continue; }

      const n = { dem_yes: 0, dem_no: 0, dem_other: 0, rep_yes: 0, rep_no: 0, rep_other: 0, oth_yes: 0, oth_no: 0, oth_other: 0 };
      let unknown = 0;
      const total = { yes: 0, no: 0, other: 0 };
      for (const x of voters) {
        const opt = x.option === 'yes' ? 'yes' : x.option === 'no' ? 'no' : 'other';
        total[opt]++;
        const p = party(x.voter?.party);
        if (!p) unknown++;
        else n[`${p}_${opt}` as keyof typeof n]++;
      }

      rows.set(v.id, {
        vote_key: v.id,
        state,
        bill_identifier: String(b.identifier).slice(0, 40),
        bill_title: String(b.title).trim().slice(0, 300),
        bill_kind: kinds[0] ?? 'bill',
        session: b.session ?? null,
        chamber,
        chamber_name: String(v.organization?.name ?? chamber).slice(0, 60),
        motion: motion.slice(0, 160),
        voted_at: at.toISOString(),
        voted_on: fmt.format(at),
        passed: v.result === 'pass',
        ...total,
        ...n,
        party_unknown: unknown,
        seats: size,
        record_url: [v.sources?.[0]?.url, b.sources?.[0]?.url].find(isHttp) ?? null,
        openstates_url: b.openstates_url,
      });
    }
  }
  return { rows: [...rows.values()], seen, dropped };
}

async function collectState(s: any) {
  const state: string = s.state;
  const [name] = STATES[state];
  const q = encodeURIComponent(name);
  const started = used;
  let upper: number | null = s.upper_seats, lower: number | null = s.lower_seats;

  // Stamped first, so a state that fails goes to the back of the queue instead of blocking it.
  await db(`collector_states?state=eq.${state}`, { method: 'PATCH', body: JSON.stringify({ last_run_at: new Date().toISOString(), last_result: { started: true } }) });

  if (!s.seats_at || Date.now() - +new Date(s.seats_at) > SEATS_MAX_AGE_MS) {
    const count = async (cls: string) => (await openStates(`people?jurisdiction=${q}&org_classification=${cls}&per_page=1`))?.pagination?.total_items ?? null;
    if (state === 'NE') { upper = await count('legislature'); lower = null; }
    else { upper = await count('upper'); lower = await count('lower'); }
    await db(`collector_states?state=eq.${state}`, { method: 'PATCH', body: JSON.stringify({ upper_seats: upper, lower_seats: lower, seats_at: new Date().toISOString() }) });
  }

  let kept: Record<string, unknown>[] = [], seen = 0;
  const dropped: Record<string, number> = {};
  for (let page = 1; page <= 2; page++) {
    const j = await openStates(`bills?jurisdiction=${q}&sort=latest_action_desc&include=votes&include=sources&per_page=20&page=${page}`);
    const r = rowsFor(state, j?.results ?? [], { upper, lower });
    kept = kept.concat(r.rows);
    seen += r.seen;
    for (const [why, n] of Object.entries(r.dropped)) dropped[why] = (dropped[why] ?? 0) + n;
    if (kept.length >= 3 || page >= (j?.pagination?.max_page ?? 1) || used >= RUN_BUDGET) break;
  }

  const unique = [...new Map(kept.map((r) => [r.vote_key as string, r])).values()];
  if (unique.length) {
    await db('state_votes?on_conflict=vote_key', {
      method: 'POST', body: JSON.stringify(unique),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }
  const result = { kept: unique.length, votes_seen: seen, dropped, seats: { upper, lower }, requests: used - started };
  await db(`collector_states?state=eq.${state}`, { method: 'PATCH', body: JSON.stringify({ last_result: result }) });
  return result;
}

Deno.serve(async (req: Request) => {
  if (!OS_KEY) return json({ ran: false, reason: 'the Open-States secret is missing' }, 500);
  used = 0;

  const since = new Date(Date.now() - 864e5).toISOString();
  const runs: any[] = (await db(`collector_runs?select=started_at,requests&started_at=gte.${since}&order=started_at.desc`)) ?? [];
  if (runs[0] && Date.now() - +new Date(runs[0].started_at) < MIN_GAP_MS) return json({ ran: false, reason: 'ran less than 5 minutes ago' });
  const today = runs.reduce((a, r) => a + (r.requests ?? 0), 0);
  if (today + RUN_BUDGET > DAY_BUDGET) return json({ ran: false, reason: 'daily request budget used' });

  // Counted as a full run until it finishes, so a crashed run still uses up its share of the day.
  const [run] = await db('collector_runs', { method: 'POST', body: JSON.stringify({ requests: RUN_BUDGET }), headers: { Prefer: 'return=representation' } });

  const asked = (new URL(req.url).searchParams.get('states') ?? '').toUpperCase().split(',').filter((s) => STATES[s]).slice(0, 4);
  const states: any[] = asked.length
    ? await db(`collector_states?state=in.(${asked.join(',')})`)
    : await db('collector_states?order=last_run_at.asc.nullsfirst&limit=4');

  const done: Record<string, unknown> = {};
  let stopped: string | null = null;
  for (const s of states) {
    if (used >= RUN_BUDGET) break;
    try {
      done[s.state] = await collectState(s);
    } catch (e) {
      if (e instanceof Stop) { stopped = e.message; break; }
      done[s.state] = { error: String((e as Error).message).slice(0, 120) };
      await db(`collector_states?state=eq.${s.state}`, { method: 'PATCH', body: JSON.stringify({ last_result: done[s.state] }) }).catch(() => {});
    }
  }

  await db(`collector_runs?id=eq.${run.id}`, { method: 'PATCH', body: JSON.stringify({ requests: used, detail: { states: done, stopped } }) });
  return json({ ran: true, requests: used, states: done, stopped });
});
