// Reviewer assistant for the reviewer console (review.html): the "Both sides" queue and the weird-news picks' hook
// lines. See docs/assist.md.
//
// Runs inside Supabase, where the Anthropic key is stored as a secret; the browser never sees it.
// Deployed with verify_jwt on, so Supabase rejects calls without a valid JWT before this code runs.
// This code then checks that the caller is a signed-in user who is listed in public.reviewers.
//
// POST /functions/v1/assist   { action: "check_topic" | "verify_quote" | "draft_from_source" | "draft_hook" | "draft_summary" | "status", ... }
//
// Advisory only: it writes nothing to the database, every quote it drafts is re-checked word for word against the
// page it fetched, and every hook line it drafts is re-checked against the house rules (length, clickbait, capitals,
// marks, numbers not in the headline or page) before the reviewer sees it, and every summary it drafts against the
// summary rules (2-4 sentences, at most 700 characters, no run of 8+ words shared with the headline, the page or the
// editor's notes). A page behind a bot wall (UPI's Cloudflare check) is reported, never worked around. The pure logic
// is in logic.mjs and summaryrules.mjs (tested from Node in tests/assist.test.mjs and tests/summary.test.mjs).
// Deploy all three files: index.ts, logic.mjs, summaryrules.mjs.

import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import {
  addressesAllowed, bearerToken, capText, checkTopicContent, CHECK_TOPIC_SCHEMA, checkUrl, claudeRequest,
  CLAUDE_ACTIONS, contentKind, corsHeaders, createRateLimiter, DRAFT_SCHEMA, draftContent, FETCH_MAX_BYTES,
  FETCH_MAX_REDIRECTS, FETCH_MESSAGES, FETCH_TIMEOUT_MS, findVerbatim, hookContent, HOOK_PAGE_MAX_CHARS, HOOK_SCHEMA,
  htmlToText, isBotWall, normalizeText, pageGrams, RATE_LIMIT, readable, readClaudeReply, shapeCheckResult, shapeDraftResult,
  shapeHookResult, shapeSummaryResult, summaryContent, SUMMARY_PAGE_MAX_CHARS, SUMMARY_SCHEMA, usageSummary, validateRequest,
} from './logic.mjs';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
// The owner may have named the secret differently; the first one that is set wins.
const KEY_NAMES = ['ANTHROPIC_API_KEY', 'Anthropic', 'ANTHROPIC'];
const anthropicKey = () => KEY_NAMES.map((n) => Deno.env.get(n) ?? '').find((v) => v.trim()) ?? '';
const EXTRA_ORIGINS = (Deno.env.get('ASSIST_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Best effort: one counter per isolate, so a busy function with several isolates allows more.
const limiter = createRateLimiter();

let client: Anthropic | null = null;
let clientKey = '';
function anthropic(apiKey: string) {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
    clientKey = apiKey;
  }
  return client;
}

type Json = Record<string, unknown>;
// logic.mjs is plain JavaScript; these are the shapes it returns.
type Validated =
  | { ok: false; message: string }
  | { ok: true; action: 'status'; input: Record<string, never> }
  | { ok: true; action: 'verify_quote'; input: { quote: string; source_url: string } }
  | { ok: true; action: 'draft_from_source'; input: { source_url: string; topic_hint: string } }
  | { ok: true; action: 'draft_hook'; input: { title: string; outlet: string; url: string } }
  | { ok: true; action: 'draft_summary'; input: { title: string; outlet: string; url: string; notes: string } }
  | { ok: true; action: 'check_topic'; input: { topic: Json } };
type UrlCheck = { ok: false; reason: string } | { ok: true; url: string; host: string; ip: string | null };
const fetchMessage = (reason: string) => (FETCH_MESSAGES as Record<string, string>)[reason] ?? 'The page could not be read.';

// ───────────────────────────── who is calling ─────────────────────────────

async function whoIs(token: string, apikey: string): Promise<{ status: 200; id: string } | { status: 401 | 403 | 502 }> {
  const headers = { apikey, Authorization: `Bearer ${token}` };
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers, signal: AbortSignal.timeout(5000) });
    if (u.status === 401 || u.status === 403) return { status: 401 };
    if (!u.ok) return { status: 502 };
    const user = await u.json().catch(() => null);
    if (!user?.id) return { status: 401 }; // the anon key on its own has no user
    const r = await fetch(`${SB_URL}/rest/v1/reviewers?select=user_id`, { headers, signal: AbortSignal.timeout(5000) });
    if (r.status === 401) return { status: 401 };
    if (!r.ok) return { status: 502 };
    const rows = await r.json().catch(() => null);
    // Row-level security returns the caller's own row only if they are a reviewer.
    return Array.isArray(rows) && rows.some((x) => x?.user_id === user.id) ? { status: 200, id: user.id } : { status: 403 };
  } catch {
    return { status: 502 };
  }
}

// ───────────────────────────── fetching a source page ─────────────────────────────

type Page = { ok: true; text: string; url: string } | { ok: false; reason: string; http_status?: number };

// Every name must resolve only to public addresses. A failed lookup blocks the link.
async function hostIsPublic(host: string, signal: AbortSignal): Promise<'ok' | 'private_host' | 'dns'> {
  const found: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try { found.push(...await Deno.resolveDns(host, type, { signal })); } catch { /* no records of this type */ }
  }
  if (!found.length) return 'dns';
  return addressesAllowed(found) ? 'ok' : 'private_host';
}

async function readCapped(res: Response): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > FETCH_MAX_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function fetchPage(start: string): Promise<Page> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let next = start;
  try {
    for (let hop = 0; ; hop++) {
      const shape = checkUrl(next) as UrlCheck;
      if (!shape.ok) return { ok: false, reason: shape.reason };
      if (!shape.ip) {
        const dns = await hostIsPublic(shape.host, signal);
        if (dns !== 'ok') return { ok: false, reason: dns };
      }
      const res = await fetch(shape.url, {
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': 'gatecast-reviewer-assistant/1.0', Accept: 'text/html, text/plain;q=0.9' },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (hop >= FETCH_MAX_REDIRECTS) return { ok: false, reason: 'too_many_redirects' };
        next = new URL(location, shape.url).href; // checked again at the top of the loop
        continue;
      }
      if (!res.ok) {
        const wall = isBotWall({ status: res.status, server: res.headers.get('server') ?? '', mitigated: res.headers.get('cf-mitigated') ?? '' });
        await res.body?.cancel();
        return { ok: false, reason: wall ? 'blocked' : 'http_error', http_status: res.status };
      }
      const declared = contentKind(res.headers.get('content-type'));
      if (declared.kind === 'pdf') { await res.body?.cancel(); return { ok: false, reason: 'pdf' }; }
      if (declared.kind === 'other') { await res.body?.cancel(); return { ok: false, reason: 'unsupported_type' }; }
      if (Number(res.headers.get('content-length') ?? 0) > FETCH_MAX_BYTES) { await res.body?.cancel(); return { ok: false, reason: 'too_large' }; }
      const bytes = await readCapped(res);
      if (!bytes) return { ok: false, reason: 'too_large' };
      const kind = contentKind(res.headers.get('content-type'), new TextDecoder('latin1').decode(bytes.subarray(0, 5)));
      if (kind.kind === 'pdf') return { ok: false, reason: 'pdf' };
      let decoder: TextDecoder;
      try { decoder = new TextDecoder(kind.charset || 'utf-8'); } catch { decoder = new TextDecoder('utf-8'); }
      const raw = decoder.decode(bytes);
      if (isBotWall({ status: res.status, mitigated: res.headers.get('cf-mitigated') ?? '', text: raw })) return { ok: false, reason: 'blocked', http_status: res.status };
      const text = kind.kind === 'html' ? htmlToText(raw) : readable(raw);
      return text ? { ok: true, text, url: shape.url } : { ok: false, reason: 'empty' };
    }
  } catch (err) {
    return { ok: false, reason: err instanceof DOMException && err.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

// ───────────────────────────── Claude ─────────────────────────────

type Reply = { ok: true; data: Json; model: string; fallback: boolean } | { ok: false; status: number; body: Json };

async function askClaude(apiKey: string, action: string, content: unknown[], schema: Json): Promise<Reply> {
  const params = claudeRequest({ content, schema }) as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
  try {
    const msg = await anthropic(apiKey).beta.messages.create(params);
    // Token use goes to the function log only.
    console.log(JSON.stringify({ assist: action, model: msg.model, stop_reason: msg.stop_reason, ...usageSummary(msg.usage) }));
    return readClaudeReply(msg) as Reply;
  } catch (err) {
    // Most specific first. Details go to the log; the browser gets a short code.
    const log = (code: string) => console.error(JSON.stringify({ assist: action, error: code, status: (err as { status?: number })?.status ?? null, request_id: (err as { requestID?: string })?.requestID ?? null }));
    const fail = (status: number, code: string): Reply => { log(code); return { ok: false, status, body: { error: code } }; };
    if (err instanceof Anthropic.RateLimitError) return fail(429, 'claude_busy');
    if (err instanceof Anthropic.AuthenticationError) return fail(502, 'assistant_key_rejected');
    if (err instanceof Anthropic.PermissionDeniedError) return fail(502, 'assistant_key_rejected');
    if (err instanceof Anthropic.BadRequestError) return fail(502, 'claude_bad_request');
    if (err instanceof Anthropic.OverloadedError) return fail(502, 'claude_overloaded');
    if (err instanceof Anthropic.InternalServerError) return fail(502, 'claude_unavailable');
    if (err instanceof Anthropic.APIConnectionTimeoutError) return fail(502, 'claude_timeout');
    if (err instanceof Anthropic.APIConnectionError) return fail(502, 'claude_unreachable');
    if (err instanceof Anthropic.APIError) return fail(502, 'claude_error');
    throw err;
  }
}

// ───────────────────────────── the endpoint ─────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get('origin') ?? '', EXTRA_ORIGINS);
  const reply = (body: Json, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);

  const token = bearerToken(req.headers.get('authorization'));
  if (!token) return reply({ error: 'unauthorized' }, 401);

  const raw = await req.text();
  if (raw.length > 64_000) return reply({ error: 'bad_request', message: 'The request is too large.' }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: 'bad_request', message: 'Send a JSON body.' }, 400); }

  const who = await whoIs(token, SB_ANON || req.headers.get('apikey') || '');
  if (who.status === 401) return reply({ error: 'unauthorized' }, 401);
  if (who.status === 403) return reply({ error: 'not_a_reviewer' }, 403);
  if (who.status !== 200) return reply({ error: 'auth_unavailable' }, 502);

  const v = validateRequest(body) as Validated;
  if (!v.ok) return reply({ error: 'bad_request', message: v.message }, 400);

  const apiKey = anthropicKey();
  if (v.action === 'status') {
    return reply({ configured: Boolean(apiKey), limit: RATE_LIMIT, remaining: limiter.peek(who.id) });
  }
  if ((CLAUDE_ACTIONS as string[]).includes(v.action) && !apiKey) return reply({ error: 'assistant_not_configured' }, 503);

  const slot = limiter.take(who.id);
  if (!slot.ok) return reply({ error: 'rate_limited', retry_after: slot.retry_after }, 429, { 'Retry-After': String(slot.retry_after) });

  if (v.action === 'verify_quote') {
    const page = await fetchPage(v.input.source_url);
    if (!page.ok) return reply({ status: 'unreachable', reason: page.reason, message: fetchMessage(page.reason), http_status: page.http_status ?? null });
    const hit = findVerbatim(normalizeText(page.text), v.input.quote);
    return reply(hit.found ? { status: 'found', context: hit.context } : { status: 'not_found' });
  }

  if (v.action === 'check_topic') {
    const r = await askClaude(apiKey, v.action, checkTopicContent(v.input.topic), CHECK_TOPIC_SCHEMA as Json);
    if (!r.ok) return reply(r.body, r.status);
    return reply({ ...shapeCheckResult(r.data), model: r.model, fallback: r.fallback });
  }

  if (v.action === 'draft_hook') {
    // The headline alone, unless a link was given and the page passes the same fences as every other fetch. A page
    // that cannot be read is reported, and the hooks are drafted from the headline alone.
    let read: { text: string; url: string; truncated: boolean } | null = null;
    let pageProblem: Json | null = null;
    if (v.input.url) {
      const got = await fetchPage(v.input.url);
      if (got.ok) {
        const cut = capText(got.text, HOOK_PAGE_MAX_CHARS);
        read = { text: cut.text, url: got.url, truncated: cut.truncated };
      } else {
        pageProblem = { reason: got.reason, message: fetchMessage(got.reason), http_status: got.http_status ?? null };
      }
    }
    const r = await askClaude(apiKey, v.action, hookContent({ title: v.input.title, outlet: v.input.outlet, page: read }), HOOK_SCHEMA as Json);
    if (!r.ok) return reply(r.body, r.status);
    return reply({
      ...shapeHookResult(r.data, { title: v.input.title, pageText: read?.text ?? '' }),
      source: read ? 'page' : 'headline',
      page_problem: pageProblem,
      truncated: read?.truncated ?? false,
      model: r.model,
      fallback: r.fallback,
    });
  }

  if (v.action === 'draft_summary') {
    // The same fences as draft_hook: the headline and the editor's notes, plus the page when a link was given and it
    // could be read. A page that cannot be read (a bot wall, an error) is reported and the drafts use the rest.
    let read: { text: string; url: string; truncated: boolean } | null = null;
    let pageProblem: Json | null = null;
    if (v.input.url) {
      const got = await fetchPage(v.input.url);
      if (got.ok) {
        const cut = capText(got.text, SUMMARY_PAGE_MAX_CHARS);
        read = { text: cut.text, url: got.url, truncated: cut.truncated };
      } else {
        pageProblem = { reason: got.reason, message: fetchMessage(got.reason), http_status: got.http_status ?? null };
      }
    }
    const r = await askClaude(apiKey, v.action, summaryContent({ title: v.input.title, outlet: v.input.outlet, notes: v.input.notes, page: read }), SUMMARY_SCHEMA as Json);
    if (!r.ok) return reply(r.body, r.status);
    return reply({
      ...shapeSummaryResult(r.data, { title: v.input.title, pageText: read?.text ?? '', notes: v.input.notes }),
      source: read ? 'page' : 'headline',
      notes_used: Boolean(v.input.notes),
      page_problem: pageProblem,
      page_grams: pageGrams(read?.text ?? ''),
      truncated: read?.truncated ?? false,
      model: r.model,
      fallback: r.fallback,
    });
  }

  // draft_from_source
  const page = await fetchPage(v.input.source_url);
  if (!page.ok) return reply({ error: 'source_unreadable', reason: page.reason, message: fetchMessage(page.reason), http_status: page.http_status ?? null }, 422);
  const cut = capText(page.text);
  const r = await askClaude(apiKey, v.action, draftContent({ text: cut.text, url: page.url, topicHint: v.input.topic_hint, truncated: cut.truncated }), DRAFT_SCHEMA as Json);
  if (!r.ok) return reply(r.body, r.status);
  return reply({
    ...shapeDraftResult(r.data, cut.text, page.url),
    truncated: cut.truncated,
    chars_read: cut.text.length,
    total_chars: cut.total_chars,
    model: r.model,
    fallback: r.fallback,
  });
});
