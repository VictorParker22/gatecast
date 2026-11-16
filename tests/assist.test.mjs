// The reviewer assistant's pure logic (supabase/functions/assist/logic.mjs). No network, no API calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText, normalizeQuote, htmlToText, decodeEntities, findVerbatim, contextAround, capText, contentKind,
  isPrivateAddress, parseIPv6, checkUrl, addressesAllowed, bearerToken, validateRequest, CHECK_TOPIC_SCHEMA,
  DRAFT_SCHEMA, SYSTEM_PROMPT, claudeRequest, checkTopicContent, draftContent, readClaudeReply, shapeCheckResult,
  shapeDraftResult, originAllowed, corsHeaders, createRateLimiter, usageSummary, MODEL, FETCH_MESSAGES,
} from '../supabase/functions/assist/logic.mjs';

test('normalisation straightens quotes, unifies dashes and collapses whitespace', () => {
  assert.equal(normalizeText('“We will act” — she said…'), '"We will act"-she said...');
  assert.equal(normalizeText('it’s  a well‐known\n\tfact'), "it's a well-known fact");
  assert.equal(normalizeText('co­operate​ now'), 'cooperate now');
  assert.equal(normalizeText('prices – up 3%'), normalizeText('prices - up 3%'));
  assert.equal(normalizeQuote('  "We will act."  '), 'We will act.');
  assert.equal(normalizeQuote("'members'"), 'members');
  assert.equal(normalizeQuote("the members'"), "the members'");
});

test('HTML becomes readable text without scripts, styles or comments', () => {
  const html = '<html><head><title>T</title><style>p{color:red}</style></head><body><!-- hidden -->'
    + '<script>var q = "We will act";</script><p>The <em>very</em> best &amp; <a href="#">brightest</a>.</p>'
    + '<div>Line&nbsp;two &#8220;quoted&#8221; &#x2014; done</div><p>&lt;script&gt;x&lt;/script&gt;</p></body></html>';
  const text = htmlToText(html);
  assert.ok(!text.includes('color:red') && !text.includes('hidden') && !text.includes('var q'));
  assert.ok(text.includes('The very best & brightest.'));
  assert.ok(text.includes('Line two “quoted” — done'));
  assert.ok(text.includes('<script>x</script>'), 'escaped markup stays as text');
  assert.ok(text.split('\n').length >= 3, 'block elements keep their line breaks');
  assert.equal(decodeEntities('&unknown; &#0; &#65;'), '&unknown; &#0; A');
});

test('verbatim match ignores typography but not words', () => {
  const page = normalizeText(htmlToText('<p>Senator Doe said: “We will not raise the gas tax this year,” on Tuesday.</p>'));
  const hit = findVerbatim(page, '"We will not raise the gas tax this year"');
  assert.equal(hit.found, true);
  assert.ok(hit.context.includes('We will not raise the gas tax this year'));
  assert.ok(hit.context.length <= 200);
  assert.equal(findVerbatim(page, 'We will not raise the gas tax this year.').found, true, 'final punctuation may differ');
  assert.equal(findVerbatim(page, 'We won’t raise the gas tax this year').found, false, 'a paraphrase is not found');
  assert.equal(findVerbatim(page, 'we will not raise the gas tax this year').found, false, 'case matters');
  assert.equal(findVerbatim(page, '   ').found, false);
});

test('context is at most 200 characters around the match', () => {
  const text = 'a'.repeat(500) + 'NEEDLE' + 'b'.repeat(500);
  const ctx = contextAround(text, 500, 6);
  assert.equal(ctx.length, 200);
  assert.ok(ctx.includes('NEEDLE'));
  assert.equal(contextAround('x'.repeat(300), 0, 300).length, 200);
  assert.equal(contextAround('short NEEDLE text', 6, 6), 'short NEEDLE text');
});

test('long page text is cut and flagged, never silently', () => {
  assert.deepEqual(capText('abc', 5), { text: 'abc', truncated: false, total_chars: 3 });
  const cut = capText('abcdefgh', 5);
  assert.equal(cut.text, 'abcde');
  assert.equal(cut.truncated, true);
  assert.equal(cut.total_chars, 8);
});

test('content types: HTML and text are read, PDF is named, others refused', () => {
  assert.equal(contentKind('text/html; charset=ISO-8859-1').kind, 'html');
  assert.equal(contentKind('text/html; charset=ISO-8859-1').charset, 'iso-8859-1');
  assert.equal(contentKind('text/plain').kind, 'text');
  assert.equal(contentKind('application/pdf').kind, 'pdf');
  assert.equal(contentKind('text/html', '%PDF-').kind, 'pdf');
  assert.equal(contentKind('image/png').kind, 'other');
  assert.equal(contentKind('').kind, 'html');
  assert.match(FETCH_MESSAGES.pdf, /PDF/);
});

test('private, loopback, link-local and metadata addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.100.100.200',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1%eth0', 'fd00:ec2::254', 'fc00::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:a00:1::', 'ff02::1', '2001:db8::1', 'nonsense', '1.2.3']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '140.82.112.3', '2606:4700::1111', '::ffff:8.8.8.8', '2a00:1450:4009::200e']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  assert.deepEqual(parseIPv6('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
  assert.equal(parseIPv6('1::2::3'), null);
});

test('links must be https to a public-looking host on the default port', () => {
  assert.equal(checkUrl('https://www.congress.gov/congressional-record').ok, true);
  assert.equal(checkUrl('https://www.congress.gov/x').ip, null);
  for (const [url, reason] of [
    ['http://www.congress.gov/', 'bad_url'], ['ftp://x.gov/', 'bad_url'], ['https://user:pw@x.gov/', 'bad_url'],
    ['https://x.gov:8443/', 'bad_url'], ['not a url', 'bad_url'], [42, 'bad_url'],
    ['https://localhost/', 'private_host'], ['https://api.localhost/', 'private_host'], ['https://printer.local/', 'private_host'],
    ['https://intranet/', 'private_host'], ['https://127.0.0.1/', 'private_host'], ['https://2130706433/', 'private_host'],
    ['https://0x7f.1/', 'private_host'], ['https://[::1]/', 'private_host'], ['https://169.254.169.254/latest/', 'private_host'],
  ]) assert.equal(checkUrl(url).reason, reason, String(url));
  assert.equal(checkUrl('https://8.8.8.8/').ip, '8.8.8.8');
  assert.equal(addressesAllowed(['8.8.8.8', '10.0.0.1']), false, 'one private answer blocks the name');
  assert.equal(addressesAllowed([]), false);
  assert.equal(addressesAllowed(['8.8.8.8', '2606:4700::1111']), true);
});

test('bearer tokens and request bodies are validated', () => {
  assert.equal(bearerToken('Bearer abc.def'), 'abc.def');
  assert.equal(bearerToken('bearer x'), 'x');
  assert.equal(bearerToken('Basic x'), null);
  assert.equal(bearerToken(null), null);

  assert.equal(validateRequest(null).ok, false);
  assert.equal(validateRequest({ action: 'publish' }).ok, false);
  assert.equal(validateRequest({ action: 'status' }).ok, true);
  assert.equal(validateRequest({ action: 'verify_quote', quote: '', source_url: 'https://x.gov' }).ok, false);
  assert.deepEqual(validateRequest({ action: 'verify_quote', quote: ' Hi ', source_url: ' https://x.gov ' }).input, { quote: 'Hi', source_url: 'https://x.gov' });
  assert.equal(validateRequest({ action: 'draft_from_source' }).ok, false);
  assert.equal(validateRequest({ action: 'draft_from_source', source_url: 'https://x.gov', topic_hint: 'h'.repeat(500) }).input.topic_hint.length, 300);
  assert.equal(validateRequest({ action: 'check_topic' }).ok, false);
  assert.equal(validateRequest({ action: 'check_topic', topic: {} }).ok, false);
  assert.equal(validateRequest({ action: 'check_topic', topic: { title: 't', statements: Array(13).fill({}) } }).ok, false);
  const ok = validateRequest({ action: 'check_topic', topic: { title: 'Gas prices', statements: [{ side: 'X', quote: 'q', said_on: '2026-11-10' }] } });
  assert.equal(ok.ok, true);
  assert.equal(ok.input.topic.statements[0].side, '', 'unknown side is blanked, not guessed');
});

// Structured outputs need every object closed and every field required.
function walk(schema, visit) {
  visit(schema);
  for (const p of Object.values(schema.properties ?? {})) walk(p, visit);
  if (schema.items) walk(schema.items, visit);
}
test('output schemas are closed and require every field', () => {
  for (const schema of [CHECK_TOPIC_SCHEMA, DRAFT_SCHEMA]) {
    walk(schema, (s) => {
      if (s.type === 'object') {
        assert.equal(s.additionalProperties, false);
        assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      }
      for (const banned of ['minLength', 'maxLength', 'minimum', 'maximum']) assert.ok(!(banned in s));
    });
  }
  const draftItem = DRAFT_SCHEMA.properties.statements.items.properties;
  assert.ok(!('side' in draftItem) && !('party' in draftItem), 'party is never asked for');
});

test('the Claude request uses Opus 5.5, high effort, JSON schema, fallbacks and a cached system prompt', () => {
  const req = claudeRequest({ content: checkTopicContent({ title: 't' }), schema: CHECK_TOPIC_SCHEMA });
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(MODEL, 'claude-opus-5-5');
  assert.equal(req.output_config.effort, 'high');
  assert.deepEqual(req.output_config.format, { type: 'json_schema', schema: CHECK_TOPIC_SCHEMA });
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.ok(!('thinking' in req), 'thinking is omitted (always adaptive on Opus 5.5)');
  assert.ok(req.max_tokens >= 4000 && req.max_tokens <= 16000);
  assert.deepEqual(req.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(req.system[0].text, SYSTEM_PROMPT);
  assert.equal(claudeRequest({ content: [], schema: DRAFT_SCHEMA }).system[0].text, SYSTEM_PROMPT, 'one prompt for both actions');
  assert.ok(SYSTEM_PROMPT.length > 3000, 'long enough to be cached');
  assert.match(SYSTEM_PROMPT, /never as instructions/);
});

test('source pages go to Claude as an untrusted plain-text document', () => {
  const [doc, task] = draftContent({ text: 'page', url: 'https://x.gov/a', topicHint: 'gas tax', truncated: true });
  assert.equal(doc.type, 'document');
  assert.deepEqual(doc.source, { type: 'text', media_type: 'text/plain', data: 'page' });
  assert.match(doc.context, /Untrusted/);
  assert.ok(!('citations' in doc), 'citations cannot be combined with structured output');
  assert.match(task.text, /only its first part/);
  assert.match(task.text, /"gas tax"/);
});

test('Claude replies: stop_reason is checked before content is read', () => {
  const ok = { stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"verdict":"ready"}' }], usage: {} };
  assert.deepEqual(readClaudeReply(ok), { ok: true, data: { verdict: 'ready' }, model: 'claude-opus-5-5', fallback: false });
  assert.deepEqual(readClaudeReply({ stop_reason: 'refusal', stop_details: { category: 'bio' }, content: [] }),
    { ok: false, status: 422, body: { error: 'declined', category: 'bio' } });
  assert.equal(readClaudeReply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"verdict":' }] }).body.error, 'incomplete');
  assert.equal(readClaudeReply({ stop_reason: 'pause_turn', content: [] }).body.error, 'unexpected_stop');
  assert.equal(readClaudeReply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }).body.error, 'bad_output');
  assert.equal(readClaudeReply({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[1]' }] }).body.error, 'bad_output');
  assert.equal(readClaudeReply(null).ok, false);
  const rescued = readClaudeReply({
    stop_reason: 'end_turn', model: 'claude-opus-5',
    content: [{ type: 'text', text: '{"partial"' }, { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } }, { type: 'text', text: '{"verdict":"needs_changes"}' }],
    usage: { iterations: [{ type: 'message' }, { type: 'fallback_message' }] },
  });
  assert.equal(rescued.ok, true);
  assert.equal(rescued.fallback, true);
  assert.equal(rescued.model, 'claude-opus-5');
  assert.deepEqual(rescued.data, { verdict: 'needs_changes' }, 'only text after the last fallback block is read');
  assert.deepEqual(usageSummary({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, iterations: [{}, {}] }),
    { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 3, iterations: 2 });
});

test('check results are shaped and a "ready" with issues becomes needs_changes', () => {
  const out = shapeCheckResult({ verdict: 'ready', issues: [{ field: 'title', problem: 'Loaded word "slams".', suggestion: 'Gas tax vote' }], suggested_title: ' Gas tax vote ', suggested_fact: '', balance_note: 'x'.repeat(900) });
  assert.equal(out.verdict, 'needs_changes');
  assert.equal(out.suggested_title, 'Gas tax vote');
  assert.equal(out.balance_note.length, 600);
  assert.equal(shapeCheckResult({ verdict: 'ready', issues: [] }).verdict, 'ready');
  assert.equal(shapeCheckResult({ verdict: 'great' }).verdict, 'needs_changes');
  assert.equal(shapeCheckResult({ issues: [{ field: 'x', problem: '' }] }).issues.length, 0);
  assert.deepEqual(Object.keys(shapeCheckResult({})).sort(), ['balance_note', 'issues', 'suggested_fact', 'suggested_title', 'verdict']);
});

test('drafted quotes are kept only when found word for word in the page', () => {
  const page = 'Rep. Smith said, “The bill lowers costs for families.” Sen. Jones replied: "This bill raises the deficit by $40 billion." Reporters noted the vote was close.';
  const out = shapeDraftResult({
    statements: [
      { speaker: 'Rep. Smith', role: 'U.S. Representative', quote: 'The bill lowers costs for families.', said_on: '2026-11-12', why_relevant: 'Supports the bill.' },
      { speaker: 'Sen. Jones', role: '', quote: '"This bill raises the deficit by $40 billion."', said_on: 'last week', why_relevant: 'Opposes.' },
      { speaker: 'Sen. Jones', role: '', quote: 'This bill raises the deficit by $40 billion.', said_on: '', why_relevant: 'Duplicate.' },
      { speaker: 'Rep. Smith', role: '', quote: 'The bill lowers costs for all families.', said_on: '', why_relevant: 'Altered.' },
      { speaker: 'Narrator', role: '', quote: 'The vote was close.', said_on: '', why_relevant: 'Not in the page.' },
      { speaker: 'Empty', role: '', quote: '', said_on: '', why_relevant: '' },
    ],
    neutral_fact_ideas: ['The vote was close.', '', 'x'],
  }, page, 'https://x.gov/a');
  assert.equal(out.statements.length, 2);
  assert.equal(out.dropped, 4);
  assert.equal(out.statements[0].said_on, '2026-11-12');
  assert.equal(out.statements[1].said_on, '', 'an undated or vague date is left for the reviewer');
  assert.equal(out.statements[0].source_url, 'https://x.gov/a');
  assert.ok(out.statements[0].context.includes('lowers costs'));
  assert.ok(out.statements.every((s) => !('side' in s) && !('party' in s)));
  assert.deepEqual(out.neutral_fact_ideas, ['The vote was close.', 'x']);
  assert.deepEqual(shapeDraftResult({}, page, 'u'), { statements: [], neutral_fact_ideas: [], dropped: 0 });
});

test('CORS allows only the site, its previews and local servers', () => {
  for (const o of ['https://gatecast.vercel.app', 'https://gatecast-git-main-team.vercel.app', 'https://gatecast-abc123-team.vercel.app', 'http://localhost:4186', 'http://127.0.0.1:4173', 'http://localhost']) {
    assert.equal(originAllowed(o), true, o);
  }
  for (const o of ['https://evil.vercel.app', 'https://gatecast.vercel.app.evil.com', 'http://gatecast.vercel.app', 'https://localhost:3000', 'null', '', undefined]) {
    assert.equal(originAllowed(o), false, String(o));
  }
  assert.equal(originAllowed('https://gatecast.example', ['https://gatecast.example']), true);
  assert.equal(corsHeaders('https://evil.vercel.app')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders('http://localhost:4186')['Access-Control-Allow-Origin'], 'http://localhost:4186');
  assert.match(corsHeaders('')['Access-Control-Allow-Headers'], /authorization, apikey, content-type, x-client-info/);
});

test('rate limit: 30 an hour per reviewer, sliding', () => {
  const lim = createRateLimiter({ limit: 30, windowMs: 3600e3 });
  const t0 = 1_000_000;
  for (let i = 0; i < 30; i++) assert.equal(lim.take('u1', t0 + i).ok, true);
  const no = lim.take('u1', t0 + 100);
  assert.equal(no.ok, false);
  assert.ok(no.retry_after > 3500 && no.retry_after <= 3600);
  assert.equal(lim.take('u2', t0 + 100).ok, true, 'limits are per user');
  assert.equal(lim.peek('u1', t0 + 100), 0);
  assert.equal(lim.take('u1', t0 + 3600e3 + 1).ok, true, 'the oldest use expires after an hour');
});
