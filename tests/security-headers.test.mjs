// The browser protection headers (lib/security-headers.js, vercel.json, server.js) and the places where data from
// outside services is made safe before a page prints it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../lib/security-headers.js');
const P = require('../scripts/security-headers.cjs');
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const siteWide = vercel.headers.find((h) => h.source === '/(.*)');
const sent = Object.fromEntries(siteWide.headers.map((h) => [h.key, h.value]));
const csp = sent['Content-Security-Policy'];
const directive = (name) => (csp.split('; ').find((d) => d.startsWith(name + ' ')) || '').slice(name.length + 1);

test('vercel.json sends the headers lib/security-headers.js works out from the real pages (node scripts/security-headers.cjs --write)', async () => {
  const want = await P.productionHeaders();
  assert.deepEqual(siteWide.headers.filter((h) => h.key !== 'Cache-Control').map((h) => [h.key, h.value]), want);
  assert.deepEqual(want.map(([k]) => k), ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy']);
  assert.equal(siteWide.headers[0].key, 'Cache-Control', 'the entry keeps its own header');
  assert.equal(vercel.headers.filter((h) => h.source === '/(.*)').length, 1);
});

test('the policy: scripts are ours, the hashed inline ones and two named services; nothing inline or evaluated otherwise', () => {
  const scripts = directive('script-src').split(' ');
  assert.ok(scripts.includes("'self'") && scripts.includes("'wasm-unsafe-eval'"));
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", 'https:', 'http:', 'data:', 'blob:', '*']) assert.ok(!scripts.includes(bad), `script-src has no ${bad}`);
  const hosts = scripts.filter((s) => s.startsWith('https://'));
  assert.deepEqual(hosts, H.SCRIPT_HOSTS);
  for (const h of hosts) assert.match(h, /^https:\/\/[a-z0-9.-]+$/, 'an exact host, no wildcard, no path');
  const hashes = scripts.filter((s) => s.startsWith("'sha256-"));
  assert.ok(hashes.length >= 3 && hashes.length <= 8, `${hashes.length} inline scripts`);
  assert.equal(directive('default-src'), "'self'");
  assert.equal(directive('object-src'), "'none'");
  assert.equal(directive('base-uri'), "'self'");
  assert.equal(directive('frame-ancestors'), "'self'");
  assert.equal(directive('form-action'), "'self' https://buttondown.com");
  assert.ok(csp.endsWith('; upgrade-insecure-requests'));
  assert.equal(sent['X-Frame-Options'], 'SAMEORIGIN');
  assert.equal(sent['X-Content-Type-Options'], 'nosniff');
  assert.match(sent['Permissions-Policy'], /camera=\(\), microphone=\(\)/);
  assert.match(sent['Permissions-Policy'], /geolocation=\(self\)/, 'the weather box asks for the visitor\'s place');
  // Locally the site is plain http: the same policy without the upgrade.
  assert.ok(!H.contentSecurityPolicy([], { upgrade: false }).includes('upgrade-insecure-requests'));
});

test('every inline script the live site serves is named in the policy, and no page relies on what the policy forbids', async () => {
  const docs = await P.productionDocuments();
  assert.ok(docs.length > 90, `${docs.length} documents: the pages, the /stacks/ pages and the weekly pages`);
  const allowed = new Set(directive('script-src').split(' '));
  for (const d of docs) {
    for (const h of H.inlineScriptHashes(d)) assert.ok(allowed.has(h), `an inline script is not in the policy: run node scripts/security-headers.cjs --write (${d.slice(0, 60)}…)`);
    assert.doesNotMatch(d, /<[^>]+\son[a-z]+\s*=\s*["']/i, 'no inline event handlers');
    assert.doesNotMatch(d, /(href|src|action)\s*=\s*["']\s*javascript:/i, 'no javascript: addresses');
    assert.doesNotMatch(d, /<script[^>]+src="(?!\/|js\/|vendor\/)[a-z]+:/i, 'no outside script in the markup');
  }
  // JSON-LD is data, not a script: it needs no hash.
  assert.deepEqual(H.inlineScriptHashes('<script type="application/ld+json">{"a":1}</script><script src="x.js"></script>'), []);
  assert.equal(H.inlineScriptHashes('<script>a</script><script type="importmap">{}</script><script>a</script>').length, 2);
  // The code the pages run never evaluates text as code.
  for (const f of fs.readdirSync(new URL('../js/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    assert.doesNotMatch(read('js/' + f), /\beval\(|new Function\(|document\.write\(/, f);
  }
});

test('server.js sends the same headers locally', () => {
  const s = read('server.js');
  assert.match(s, /securityHeaders\(/);
  assert.match(s, /res\.writeHead\(status, \{ 'Content-Type': type, \.\.\.SECURITY_HEADERS, \.\.\.extra \}\)/);
  for (const line of s.split('\n').filter((l) => l.includes('res.writeHead('))) assert.ok(line.includes('...SECURITY_HEADERS'), `every response carries them: ${line.trim().slice(0, 80)}`);
});

test('an airport from the route service is re-checked: codes, numbers and plain text only', () => {
  const { pickAirport } = require('../lib/live.js');
  const ok = { iata_code: 'jfk', icao_code: 'KJFK', name: 'John F Kennedy Intl', municipality: 'New York', country_iso_name: 'US', latitude: 40.64, longitude: '-73.78' };
  assert.deepEqual(pickAirport(ok), { iata: 'JFK', icao: 'KJFK', name: 'John F Kennedy Intl', city: 'New York', country: 'US', lat: 40.64, lon: -73.78 });
  assert.equal(pickAirport({ ...ok, iata_code: '<img src=x onerror=alert(1)>', icao_code: null }), null, 'markup is not a code');
  assert.equal(pickAirport({ ...ok, iata_code: '<img src=x onerror=alert(1)>' }).iata, null, 'the bad code is dropped, the good one kept');
  assert.equal(pickAirport({ ...ok, latitude: '1"><script>' }), null);
  assert.equal(pickAirport({ ...ok, latitude: 91 }), null);
  assert.equal(pickAirport({ ...ok, longitude: null }), null);
  assert.equal(pickAirport({ ...ok, name: '<b>x</b>\u0007y' }).name, 'bx/by');
  assert.equal(pickAirport(null), null);
  assert.equal(pickAirport('x'), null);
});

test('forecast values are numbers or null before any page prints them, fresh or from the cache', async () => {
  const D = await import('../js/data.js');
  assert.equal(D.num(12.5), 12.5);
  for (const bad of ['<img src=x onerror=alert(1)>', '12', NaN, Infinity, null, undefined, {}, [], true]) assert.equal(D.num(bad), null, String(bad));
  assert.deepEqual(D.nums({ pop: '<img src=x>', temp: 3, code: 61 }), { pop: null, temp: 3, code: 61 });
  assert.equal(D.nums('x'), null);
  assert.deepEqual(D.numRows([{ a: 1 }, 'x', null, { a: '2' }]), [{ a: 1 }, { a: null }]);
  const w = D.cleanWeather({
    at: 1, tz: 'Europe/London"><script>', now: { temp: 9, pop: '<svg onload=alert(1)>' },
    hours: [{ code: 3, pop: '<b>' }, { code: null }, 'x'], days: [{ max: 10, pop: 'x' }, { max: null }], air: { aqi: '<i>', pm25: 2 },
  });
  assert.equal(w.tz, 'UTC', 'not a time zone name');
  assert.deepEqual(w.now, { temp: 9, pop: null });
  assert.deepEqual(w.hours, [{ code: 3, pop: null }]);
  assert.deepEqual(w.days, [{ max: 10, pop: null }]);
  assert.equal(w.air, null);
  assert.equal(D.cleanWeather({ now: 'x' }), null);
  assert.equal(D.cleanWeather(null), null);
  assert.equal(D.cleanWeather({ at: 2, tz: 'America/New_York', now: { temp: 1 }, hours: [], days: [], air: { aqi: 40, pm25: 3 } }).tz, 'America/New_York');
});

test('a saved trip and a submitter\'s address are not trusted where they are printed', () => {
  const trip = read('js/trip.js');
  assert.match(trip, /const minutes = \(v\) => \{ const n = Number\(v\); return Number\.isFinite\(n\) && n > 0 \? n : null; \};/);
  assert.match(trip, /list\(trip\.d\)\.forEach\(\(m, i\) => \{ const n = minutes\(m\); if \(n\) durations\[i\] = n; \}\);/);
  assert.doesNotMatch(trip, /durations\[i\] = m;/);
  assert.match(read('js/review.js'), /mailto:\$\{esc\(encodeURIComponent\(sub\.contact_email\)\)\}/);
  const f = read('js/flights.js');
  assert.match(f, /\/\^\[A-Z0-9\]\{3,4\}\$\/\.test\(c\)/, 'the page checks the service\'s airport code too');
});

test('the owner\'s tools on public functions need the owner\'s key on the live site', () => {
  const { ownerTool } = require('../lib/site.js');
  const key = 'k'.repeat(32);
  assert.equal(ownerTool(undefined, {}), true, 'locally: no key needed');
  assert.equal(ownerTool(undefined, { VERCEL: '1' }), false, 'live with no token set: off');
  assert.equal(ownerTool('anything', { VERCEL: '1' }), false);
  assert.equal(ownerTool(key, { VERCEL: '1', GATECAST_DEBUG_TOKEN: key }), true);
  assert.equal(ownerTool(key.slice(1), { VERCEL: '1', GATECAST_DEBUG_TOKEN: key }), false);
  assert.equal(ownerTool(undefined, { GATECAST_DEBUG_TOKEN: key }), false, 'a token set anywhere is required');
  assert.equal(ownerTool('short', { VERCEL: '1', GATECAST_DEBUG_TOKEN: 'short' }), false, 'a token under 16 characters is not accepted');
  const W = require('../lib/weird.js');
  assert.equal(W.parseQuery(new URLSearchParams('debug=1')).debug, true, 'in tests (not Vercel) debug works');
  assert.match(read('lib/weird.js'), /\(get\('debug'\) === '1' \|\| get\('debug'\) === 'true'\) && ownerTool\(get\('key'\)\)/);
  assert.match(read('api/book-covers.js'), /only !== null && require\('\.\.\/lib\/site\.js'\)\.ownerTool\(/);
  assert.match(read('api/weird.js'), /weird\.parseQuery\(q\)\.debug \? weird\.DEBUG_CACHE_CONTROL/);
});
