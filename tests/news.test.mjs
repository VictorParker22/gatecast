import test from 'node:test';
import assert from 'node:assert/strict';
import news from '../lib/news.js';

const { parseFeed, selectItems, plainText, httpsUrl, normaliseState, loadNews, sameStory } = news;
const now = Date.UTC(2026, 10, 16, 12);
const HOUR = 3600e3, DAY = 24 * HOUR;
const rfc = (ms) => new Date(ms).toUTCString();

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Capitol Desk</title><link>https://desk.example.org/</link>
  <atom:link href="https://desk.example.org/feed/" rel="self" type="application/rss+xml" />
  <item>
    <title><![CDATA[Budget deal &amp; the <em>Senate</em>: what’s next]]></title>
    <link>https://desk.example.org/2026/11/budget-deal/</link>
    <pubDate>${rfc(now - 2 * HOUR)}</pubDate>
    <description><![CDATA[<p>The opening paragraph we must never copy.</p><img src="https://desk.example.org/photo.jpg">]]></description>
    <content:encoded><![CDATA[<p>Full story text.</p>]]></content:encoded>
    <media:content url="https://desk.example.org/photo.jpg" medium="image" />
  </item>
  <item>
    <title>Governor signs bill on &#8220;ghost guns&#8221; &#x2014; and vetoes another</title>
    <guid isPermaLink="true">https://desk.example.org/2026/11/ghost-guns/</guid>
    <pubDate>${rfc(now - 5 * HOUR)}</pubDate>
  </item>
  <item>
    <title>Plain http link is dropped</title>
    <link>http://desk.example.org/2026/11/insecure/</link>
    <pubDate>${rfc(now - HOUR)}</pubDate>
  </item>
  <item>
    <title>Script link is dropped</title>
    <link>javascript:alert(1)</link>
    <pubDate>${rfc(now - HOUR)}</pubDate>
  </item>
  <item>
    <title>No date is dropped</title>
    <link>https://desk.example.org/2026/11/undated/</link>
  </item>
  <item>
    <title>   </title>
    <link>https://desk.example.org/2026/11/untitled/</link>
    <pubDate>${rfc(now - HOUR)}</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Statehouse Radio</title>
  <link href="https://radio.example.org/" />
  <entry>
    <title type="html">Lawmakers &lt;b&gt;override&lt;/b&gt; veto on transit funding</title>
    <link rel="enclosure" href="https://radio.example.org/audio.mp3" />
    <link rel="alternate" type="text/html" href="https://radio.example.org/2026/11/override?utm_source=rss&amp;id=7" />
    <id>tag:radio.example.org,2026:7</id>
    <updated>2026-11-16T09:30:00Z</updated>
    <summary>Summary we never read.</summary>
  </entry>
  <entry>
    <title>Id as permalink</title>
    <id>https://radio.example.org/2026/11/id-link</id>
    <published>2026-11-15T09:30:00-05:00</published>
  </entry>
</feed>`;

test('parseFeed reads RSS 2.0: CDATA, entities, tags stripped, guid fallback', () => {
  const items = parseFeed(RSS);
  assert.deepEqual(items.map((x) => x.title), ['Budget deal & the Senate: what’s next', 'Governor signs bill on “ghost guns” — and vetoes another']);
  assert.equal(items[0].url, 'https://desk.example.org/2026/11/budget-deal/');
  assert.equal(items[0].published, Date.parse(rfc(now - 2 * HOUR)));
  assert.equal(items[1].url, 'https://desk.example.org/2026/11/ghost-guns/');
  // Only headline, link and time come out: never the description, body or image.
  assert.deepEqual(Object.keys(items[0]).sort(), ['published', 'title', 'url']);
  assert.ok(!JSON.stringify(items).includes('opening paragraph') && !JSON.stringify(items).includes('photo.jpg'));
});

test('parseFeed reads Atom: <link href> (alternate preferred), HTML titles, id fallback, offsets', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Lawmakers override veto on transit funding');
  assert.equal(items[0].url, 'https://radio.example.org/2026/11/override?utm_source=rss&id=7');
  assert.equal(items[0].published, Date.UTC(2026, 10, 16, 9, 30));
  assert.equal(items[1].url, 'https://radio.example.org/2026/11/id-link');
  assert.equal(items[1].published, Date.UTC(2026, 10, 15, 14, 30));
});

test('parseFeed survives junk', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<html><body>Not a feed</body></html>'), []);
  assert.deepEqual(parseFeed(null), []);
});

test('httpsUrl keeps only https links with a host', () => {
  assert.equal(httpsUrl(' https://a.example/x '), 'https://a.example/x');
  assert.equal(httpsUrl('http://a.example/x'), null);
  assert.equal(httpsUrl('javascript:alert(1)'), null);
  assert.equal(httpsUrl('data:text/html,hi'), null);
  assert.equal(httpsUrl('//a.example/x'), null);
  assert.equal(httpsUrl('https://user:pw@a.example/'), null);
  assert.equal(httpsUrl('<![CDATA[https://a.example/y]]>'), 'https://a.example/y');
});

test('plainText decodes entities once per layer and leaves stray ampersands and angle brackets alone', () => {
  assert.equal(plainText('AT&amp;T &amp; Verizon'), 'AT&T & Verizon');
  assert.equal(plainText('<![CDATA[Fish & chips]]>'), 'Fish & chips');
  assert.equal(plainText('Rates &lt; 5% for &#039;now&#039;'), "Rates < 5% for 'now'");
  assert.equal(plainText('Line\none\t two'), 'Line one two');
  assert.equal(plainText('<p>One</p><p>Two</p> <b>bold</b>er'), 'One Two bolder');
  assert.equal(plainText('&bogus; &#xD800;'), '&bogus; &#xD800;');
});

const item = (outlet, title, hoursAgo, url) => ({ outlet, title, url: url || `https://${outlet}.example/${encodeURIComponent(title)}`, published: now - hoursAgo * HOUR });

test('selectItems: newest first, drops anything older than 7 days or dated in the future', () => {
  const got = selectItems([
    item('a', 'Old story from last month', 24 * 30),
    item('a', 'Six days old', 24 * 6),
    item('b', 'Fresh', 1),
    item('c', 'Eight days old', 24 * 8),
    item('b', 'From the future', -5),
    item('c', 'Middle', 10),
  ], now);
  assert.deepEqual(got.map((x) => x.title), ['Fresh', 'Middle', 'Six days old']);
});

test('selectItems dedupes by link (ignoring tracking and trailing slash) and by near-identical title', () => {
  const got = selectItems([
    item('a', 'Senate passes the transit budget after a long night', 1, 'https://a.example/story/'),
    item('b', 'Another headline entirely', 2, 'https://www.a.example/story?utm_source=rss'),
    item('c', 'Senate passes the transit budget after long night', 3),
    item('d', 'SENATE PASSES THE TRANSIT BUDGET, AFTER A LONG NIGHT!', 4),
    item('e', 'Senate passes budget', 5),
  ], now);
  assert.deepEqual(got.map((x) => x.outlet), ['a', 'e']);
  // A republished story with a local prefix is the same story.
  assert.ok(sameStory('States have 6 more months to implement Medicaid work requirement, administration says',
    'Pa. and other states have 6 more months to implement Medicaid work requirement, administration says'));
  assert.ok(!sameStory('Senate passes the transit budget', 'House rejects the transit budget'));
  assert.ok(sameStory('Budget vote set for Tuesday in the Senate', 'Budget vote set for Tuesday in the Senate.'));
});

test('selectItems caps each outlet at 3 and the total at 8', () => {
  const many = [];
  for (let i = 0; i < 6; i++) many.push(item('busy', `Busy outlet story number ${i} about different things`, i));
  for (let i = 0; i < 4; i++) for (const o of ['p', 'q', 'r']) many.push(item(o, `${o} outlet headline ${i} on its own topic`, 10 + i));
  const got = selectItems(many, now);
  assert.equal(got.length, 8);
  assert.equal(got.filter((x) => x.outlet === 'busy').length, 3);
  for (const o of ['p', 'q', 'r']) assert.ok(got.filter((x) => x.outlet === o).length <= 3);
  for (let i = 1; i < got.length; i++) assert.ok(got[i - 1].published >= got[i].published);
});

test('normaliseState accepts two-letter codes we have outlets for; anything else means national', () => {
  assert.equal(normaliseState('ny'), 'NY');
  assert.equal(normaliseState(' PA '), 'PA');
  assert.equal(normaliseState('ZZ'), null);
  assert.equal(normaliseState('New York'), null);
  assert.equal(normaliseState('N1'), null);
  assert.equal(normaliseState(''), null);
  assert.equal(normaliseState(undefined), null);
});

test('loadNews tolerates a failing feed and returns only headline, link, outlet and time', async () => {
  const fake = async (url) => {
    if (url.includes('nysfocus')) return { ok: true, text: async () => RSS };
    if (url.includes('cityandstate')) throw new Error('timeout');
    return { ok: false, status: 503, text: async () => '' };
  };
  const out = await loadNews('NY', { fetchImpl: fake, now });
  assert.equal(out.state, 'NY');
  assert.equal(out.items.length, 2);
  assert.deepEqual(Object.keys(out.items[0]).sort(), ['outlet', 'outletUrl', 'published', 'title', 'url']);
  assert.equal(out.items[0].outlet, 'New York Focus');
  assert.equal(out.items[0].outletUrl, 'https://nysfocus.com/');
  assert.equal(out.items[0].published, new Date(now - 2 * HOUR).toISOString());
  assert.ok(out.sources.length >= 2 && out.sources.every((s) => /^https:/.test(s.url)));
  assert.deepEqual(out.sources.filter((s) => s.ok).map((s) => s.id), ['nysfocus']);
  assert.equal(out.checkedAt, new Date(now).toISOString());
  const national = await loadNews(null, { fetchImpl: async () => ({ ok: true, text: async () => ATOM }), now });
  assert.equal(national.state, null);
  assert.ok(national.items.length >= 1 && national.items.every((x) => x.url.startsWith('https://')));
});

test('every listed source has an https feed and homepage, a unique id and a state code or national', () => {
  const ids = new Set();
  for (const s of news.SOURCES) {
    assert.ok(/^https:\/\//.test(s.feed) && /^https:\/\//.test(s.homepage), s.id);
    assert.ok(s.state === 'national' || /^[A-Z]{2}$/.test(s.state), s.id);
    assert.ok(s.name && !ids.has(s.id), s.id);
    ids.add(s.id);
  }
  for (const st of ['NY', 'NJ', 'CA', 'OH', 'TX', 'FL', 'IL', 'PA']) assert.ok(news.SOURCES.some((s) => s.state === st), st);
});

/* ---------- The Today page's half of the brief (js/today.js) ---------- */

const { stateOf, isUS, relTime, cleanHeadlines, alertItems, airportSignal, US_STATES } = await import('../js/today.js');
const { assessWindow } = await import('../js/core.js');

test('stateOf maps the stored region to a state code, only for US places', () => {
  assert.equal(stateOf({ name: 'Albany', region: 'New York, United States', country: 'US' }), 'NY');
  assert.equal(stateOf({ name: 'Austin', region: 'texas, United States', country: 'US' }), 'TX');
  assert.equal(stateOf({ name: 'Washington', region: 'District of Columbia, United States', country: 'US' }), 'DC');
  assert.equal(stateOf({ name: 'Washington', region: 'Washington, D.C., United States', country: 'US' }), 'DC');
  assert.equal(stateOf({ name: 'New York', region: 'United States', country: 'US', state: 'ny' }), 'NY');
  // A place the page named from the airport list carries no region: unknown here (the page asks weather.gov).
  assert.equal(stateOf({ name: 'Columbus', region: 'near you', country: 'US' }), null);
  assert.equal(stateOf({ name: 'New York', region: 'United States', country: 'US' }), null);
  assert.equal(stateOf({ name: 'London', region: 'England, United Kingdom', country: 'GB' }), null);
  assert.equal(stateOf({ name: 'Georgia', region: 'Georgia', country: 'GE' }), null);
  assert.equal(stateOf({ name: 'Paris', region: 'Texas, United States', country: 'United States' }), 'TX');
  assert.equal(stateOf(null), null);
  assert.equal(Object.keys(US_STATES).length, 52);
  assert.ok(isUS({ country: 'US' }) && isUS({ country: 'United States' }) && !isUS({ country: 'GB' }) && !isUS({}));
});

test('relTime words', () => {
  assert.equal(relTime(now - 2 * 60e3, now), 'Just now');
  assert.equal(relTime(now + 10 * 60e3, now), 'Just now');
  assert.equal(relTime(now - 25 * 60e3, now), '25 min ago');
  assert.equal(relTime(new Date(now - 3 * HOUR - 5 * 60e3).toISOString(), now), '3 hr ago');
  assert.equal(relTime(now - 30 * HOUR, now), 'Yesterday');
  assert.equal(relTime(now - 4 * DAY, now), '4 days ago');
  assert.equal(relTime('nonsense', now), '');
});

test('cleanHeadlines keeps only https items with a title, outlet and date', () => {
  const ok = { title: 'A', url: 'https://a.example/1', outlet: 'A', published: '2026-11-16T10:00:00Z' };
  const got = cleanHeadlines({ items: [ok, { ...ok, url: 'http://a.example/2' }, { ...ok, url: 'javascript:x' }, { ...ok, title: ' ' }, { ...ok, published: 'x' }, null] });
  assert.deepEqual(got, [ok]);
  assert.deepEqual(cleanHeadlines(null), []);
  assert.deepEqual(cleanHeadlines({ error: 'upstream unavailable' }), []);
});

test('alertItems: most severe first, ended alerts dropped, missing fields tolerated', () => {
  const got = alertItems([
    { event: 'Frost Advisory', severity: 'Minor', headline: 'Frost Advisory issued…', ends: new Date(now + 6 * HOUR).toISOString() },
    { event: 'Old Warning', severity: 'Severe', ends: new Date(now - HOUR).toISOString() },
    { event: 'Winter Storm Warning', severity: 'Severe', onset: new Date(now + HOUR).toISOString(), ends: new Date(now + DAY).toISOString(), area: 'Kings; Queens' },
    { severity: 'Extreme' },
  ], now);
  assert.deepEqual(got.map((x) => [x.event, x.level]), [['Winter Storm Warning', 'high'], ['Frost Advisory', 'elevated']]);
  assert.equal(got[0].area, 'Kings; Queens');
  assert.equal(got[0].from, now + HOUR);
  assert.equal(got[1].from, null);
  assert.deepEqual(alertItems(undefined, now), []);
});

test('airportSignal only speaks when a nearby airport is at risk', () => {
  const t0 = now;
  const hrs = (code, gust = 20) => [0, 1, 2, 3].map((k) => ({ t: t0 + k * HOUR, code, gust, vis: 20000 }));
  const air = (code, hours) => ({ code, risk: assessWindow(hours, t0, t0 + 3 * HOUR) });
  assert.equal(airportSignal([air('JFK', hrs(1)), air('LGA', hrs(2))]), null);
  assert.equal(airportSignal(null), null);
  assert.equal(airportSignal([{ code: 'EWR', risk: { level: 'unknown', score: 0, factors: [] } }]), null);
  const sig = airportSignal([air('JFK', hrs(1)), air('LGA', hrs(95)), air('EWR', hrs(3, 60))]);
  assert.equal(sig.code, 'LGA');
  assert.equal(sig.level, 'high');
  assert.equal(sig.title, 'Thunderstorms near LGA in the next 3 hours');
  assert.match(sig.line, /^High weather risk for flights there, and at EWR\./);
});
