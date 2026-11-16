import test from 'node:test';
import assert from 'node:assert/strict';
import news from '../lib/news.js';

const { parseFeed, selectItems, plainText, httpsUrl, normaliseState, loadNews, sameStory, feedImage, headImage, previewImage, pageImage, pageAllowed, isPrivateAddress } = news;
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
    <description><![CDATA[<p>The opening paragraph we must never copy.</p><img src="https://desk.example.org/body-inline.jpg">]]></description>
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
  // Only headline, link, time and the preview image come out: never the description, body or a body image.
  assert.deepEqual(Object.keys(items[0]).sort(), ['image', 'published', 'title', 'url']);
  assert.deepEqual(items[0].image, { url: 'https://desk.example.org/photo.jpg' });
  assert.equal(items[1].image, null);
  const json = JSON.stringify(items);
  assert.ok(!json.includes('opening paragraph') && !json.includes('Full story') && !json.includes('body-inline.jpg'));
});

test('parseFeed reads Atom: <link href> (alternate preferred), HTML titles, id fallback, offsets', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Lawmakers override veto on transit funding');
  assert.equal(items[0].image, null); // the enclosure link is audio
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
  assert.deepEqual(Object.keys(out.items[0]).sort(), ['image', 'outlet', 'outletUrl', 'published', 'title', 'url']);
  assert.deepEqual(out.items[0].image, { url: 'https://desk.example.org/photo.jpg' });
  assert.equal(out.items[1].image, null); // its page is on another site than the outlet's, so it is never read
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
  // Every outlet carries its picture switch explicitly.
  for (const s of news.SOURCES) assert.equal(typeof s.images, 'boolean', s.id);
});

/* ---------- The Today page's half of the brief (js/today.js) ---------- */

const { stateOf, isUS, relTime, cleanHeadlines, cleanImage, monogram, tileTone, arrangeHeadlines, alertItems, airportSignal, US_STATES } = await import('../js/today.js');
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
  assert.deepEqual(got, [{ ...ok, image: null }]);
  const pic = cleanHeadlines({ items: [{ ...ok, image: { url: 'https://cdn.a.example/p.jpg', width: 1200, height: 675 } }, { ...ok, image: { url: 'data:image/png;base64,AAAA' } }] });
  assert.deepEqual(pic.map((x) => x.image), [{ url: 'https://cdn.a.example/p.jpg', width: 1200, height: 675 }, null]);
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

/* ---------- Preview images: feeds ---------- */

const rssItem = (inner, link = 'https://desk.example.org/2026/11/story/') =>
  `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>A story</title><link>${link}</link><pubDate>${rfc(now - HOUR)}</pubDate>${inner}</item></channel></rss>`;
const imageOf = (inner, link) => parseFeed(rssItem(inner, link))[0].image;

test('feed images: media:content by medium, type or file name; its size; not a video', () => {
  assert.deepEqual(imageOf('<media:content url="https://cdn.example.org/a.jpg" medium="image" width="1200" height="800" />'), { url: 'https://cdn.example.org/a.jpg', width: 1200, height: 800 });
  assert.deepEqual(imageOf('<media:content type="image/jpeg" url="https://cdn.example.org/resize/792x528!/q/?url=x"><media:description>Caption we never read</media:description><media:credit>AP</media:credit></media:content>'),
    { url: 'https://cdn.example.org/resize/792x528!/q/?url=x' });
  assert.deepEqual(imageOf('<media:content url="https://cdn.example.org/large.jpg" width="618" height="284"></media:content>'), { url: 'https://cdn.example.org/large.jpg', width: 618, height: 284 });
  // No type, no medium and no image file name: it might be anything, so it is not used.
  assert.equal(imageOf('<media:content url="https://cdn.example.org/stream" />'), null);
  assert.equal(imageOf('<media:content url="https://cdn.example.org/clip.mp4" medium="video" />'), null);
  // A caption or credit inside media:content never reaches the output.
  const item = parseFeed(rssItem('<media:content url="https://cdn.example.org/a.jpg" medium="image"><media:description>Secret caption</media:description></media:content>'))[0];
  assert.ok(!JSON.stringify(item).includes('Secret caption'));
});

test('feed images: media:thumbnail, image enclosures, Atom enclosure links, preference order and entities', () => {
  assert.deepEqual(imageOf('<media:thumbnail url="https://img.example.org/w:820/h:496/aHR0cHM6Ly9z" />'), { url: 'https://img.example.org/w:820/h:496/aHR0cHM6Ly9z' });
  assert.deepEqual(imageOf('<enclosure url="https://static.example.org/plane.jpeg" length="786" type="image/jpeg"/>'), { url: 'https://static.example.org/plane.jpeg' });
  assert.equal(imageOf('<enclosure url="https://traffic.example.org/show.mp3" length="0" type="audio/mpeg" />'), null);
  // An enclosure must say it is an image.
  assert.equal(imageOf('<enclosure url="https://static.example.org/plane.jpeg" />'), null);
  // media:content first, then the thumbnail; the thumbnail lends its size to the same picture.
  assert.deepEqual(imageOf('<media:thumbnail url="https://i.example.org/small.jpg" width="138" height="83" /><media:content url="https://i.example.org/big.jpg" medium="image" />'), { url: 'https://i.example.org/big.jpg' });
  assert.deepEqual(imageOf('<media:content type="image/jpeg" url="https://i.example.org/p.jpg?fit=1024%2C683&amp;ssl=1"></media:content><media:thumbnail url="https://i.example.org/p.jpg?fit=1024%2C683&amp;ssl=1" width="1024" height="683"/>'),
    { url: 'https://i.example.org/p.jpg?fit=1024%2C683&ssl=1', width: 1024, height: 683 });
  // A relative address resolves against the story's own address.
  assert.deepEqual(imageOf('<media:thumbnail url="/uploads/pic.jpg" />', 'https://desk.example.org/2026/11/story/'), { url: 'https://desk.example.org/uploads/pic.jpg' });
  const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom story</title>
    <link rel="enclosure" type="audio/mpeg" href="https://radio.example.org/a.mp3" />
    <link rel="enclosure" type="image/png" href="https://radio.example.org/a.png" length="1" />
    <link rel="alternate" href="https://radio.example.org/story" /><updated>2026-11-16T09:30:00Z</updated></entry></feed>`)[0];
  assert.equal(atom.url, 'https://radio.example.org/story');
  assert.deepEqual(atom.image, { url: 'https://radio.example.org/a.png' });
  assert.deepEqual(feedImage('<link rel="enclosure" href="https://radio.example.org/b.webp" />', 'https://radio.example.org/'), { url: 'https://radio.example.org/b.webp' });
});

test('image rejection: not https, data: and javascript:, SVG, pixels and tiny sizes, local hosts', () => {
  const bad = [
    '<media:content url="http://cdn.example.org/a.jpg" medium="image" />',
    '<media:content url="data:image/png;base64,iVBORw0KGgo=" medium="image" />',
    '<media:content url="javascript:alert(1)" medium="image" />',
    '<media:content url="https://cdn.example.org/logo.svg" medium="image" />',
    '<media:content url="https://cdn.example.org/logo" type="image/svg+xml" />',
    '<enclosure url="https://cdn.example.org/logo.png" type="image/svg+xml" />',
    '<media:content url="https://cdn.example.org/t.gif" medium="image" width="1" height="1" />',
    '<media:thumbnail url="https://cdn.example.org/icon.png" width="40" height="40" />',
    '<media:thumbnail url="https://cdn.example.org/track/pixel.gif" />',
    '<media:thumbnail url="https://cdn.example.org/1x1.png" />',
    '<media:thumbnail url="https://10.0.0.5/a.jpg" />',
    '<media:thumbnail url="https://localhost/a.jpg" />',
    '<media:thumbnail url="https://cdn.example.org:8443/a.jpg" />',
    '<media:thumbnail url="https://user:pw@cdn.example.org/a.jpg" />',
  ];
  for (const b of bad) assert.equal(imageOf(b), null, b);
  // A protocol-relative address takes the story's https.
  assert.deepEqual(imageOf('<media:thumbnail url="//cdn.example.org/a.jpg" />'), { url: 'https://cdn.example.org/a.jpg' });
  assert.equal(feedImage('<media:thumbnail url="//cdn.example.org/a.jpg" />', 'http://desk.example.org/x'), null);
  // A rejected candidate does not stop a good one after it.
  assert.deepEqual(imageOf('<media:content url="https://cdn.example.org/t.gif" medium="image" width="1" height="1" /><media:thumbnail url="https://cdn.example.org/ok.jpg" width="300" height="200" />'),
    { url: 'https://cdn.example.org/ok.jpg', width: 300, height: 200 });
  assert.equal(previewImage({ url: 'https://cdn.example.org/a.jpg', type: 'text/html' }), null);
  assert.deepEqual(previewImage({ url: 'https://cdn.example.org/a.jpg', width: '0', height: '' }), { url: 'https://cdn.example.org/a.jpg' });
});

/* ---------- Preview images: article pages ---------- */

const ARTICLE = 'https://desk.example.org/2026/11/story/';
test('headImage reads og:image with its size, in either attribute order, entity-encoded', () => {
  assert.deepEqual(headImage(`<html><head><title>x</title>
    <meta property="og:title" content="Not read">
    <meta content="https://cdn.example.org/a.jpg?w=1200&amp;h=630" property="og:image" />
    <meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
    </head><body><img src="https://cdn.example.org/body.jpg"></body></html>`, ARTICLE), { url: 'https://cdn.example.org/a.jpg?w=1200&h=630', width: 1200, height: 630 });
  assert.deepEqual(headImage(`<head><meta property='og:image' content='https:&#x2F;&#x2F;cdn.example.org&#x2F;b.jpg'></head>`, ARTICLE), { url: 'https://cdn.example.org/b.jpg' });
});

test('headImage resolves relative addresses, falls back to twitter:image, ignores what is not a head meta tag', () => {
  assert.deepEqual(headImage('<head><meta property="og:image" content="/wp-content/uploads/pic.jpg"></head>', ARTICLE), { url: 'https://desk.example.org/wp-content/uploads/pic.jpg' });
  assert.deepEqual(headImage('<head><meta property="og:image" content="pic.jpg"></head>', ARTICLE), { url: 'https://desk.example.org/2026/11/story/pic.jpg' });
  assert.deepEqual(headImage('<head><meta name="twitter:image" content="https://cdn.example.org/t.jpg"><meta name="twitter:card" content="summary_large_image"></head>', ARTICLE), { url: 'https://cdn.example.org/t.jpg' });
  // An unusable og:image (SVG, http) gives way to secure_url or twitter:image.
  assert.deepEqual(headImage('<head><meta property="og:image" content="https://cdn.example.org/logo.svg"><meta name="twitter:image" content="https://cdn.example.org/t2.jpg"></head>', ARTICLE), { url: 'https://cdn.example.org/t2.jpg' });
  assert.deepEqual(headImage('<head><meta property="og:image" content="http://cdn.example.org/p.jpg"><meta property="og:image:secure_url" content="https://cdn.example.org/p.jpg"></head>', ARTICLE), { url: 'https://cdn.example.org/p.jpg' });
  assert.equal(headImage('<head><meta property="og:image" content="data:image/png;base64,AAAA"></head>', ARTICLE), null);
  assert.equal(headImage('<head><meta property="og:image" content="javascript:alert(1)"></head>', ARTICLE), null);
  // No tags, tags only in a script or a comment, or only after </head>: nothing.
  assert.equal(headImage('<html><head><title>No preview</title></head><body><p>Text</p></body></html>', ARTICLE), null);
  assert.equal(headImage('<head><script>var s = \'<meta property="og:image" content="https://cdn.example.org/s.jpg">\';</script><!-- <meta property="og:image" content="https://cdn.example.org/c.jpg"> --></head>', ARTICLE), null);
  assert.equal(headImage('<head></head><body><meta property="og:image" content="https://cdn.example.org/late.jpg"></body>', ARTICLE), null);
  assert.equal(headImage('', ARTICLE), null);
  assert.equal(headImage(null, ARTICLE), null);
});

const SRC = { id: 'desk', name: 'Desk', homepage: 'https://www.desk.example.org/', feed: 'https://feeds.desk.example.org/rss', state: 'NY', images: true };
const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
const html = (head, extra = {}) => new Response(`<!doctype html><html><head>${head}</head><body>${'x'.repeat(1000)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...extra });

test('pageAllowed: only https pages on the outlet\'s own site', () => {
  assert.ok(pageAllowed('https://desk.example.org/2026/story', SRC));
  assert.ok(pageAllowed('https://www.desk.example.org/2026/story', SRC));
  assert.ok(pageAllowed('https://news.desk.example.org/story', SRC));
  assert.ok(!pageAllowed('https://evil.example.com/story', SRC));
  assert.ok(!pageAllowed('https://desk.example.org.evil.com/story', SRC));
  assert.ok(!pageAllowed('http://desk.example.org/story', SRC));
  assert.ok(!pageAllowed('https://desk.example.org:8080/story', SRC));
  assert.ok(!pageAllowed('https://127.0.0.1/story', SRC));
  assert.ok(!pageAllowed('not a url', SRC));
  assert.ok(isPrivateAddress('10.1.2.3') && isPrivateAddress('169.254.169.254') && isPrivateAddress('::1') && isPrivateAddress('fd00:ec2::254') && isPrivateAddress('::ffff:192.168.1.1'));
  assert.ok(!isPrivateAddress('93.184.216.34') && !isPrivateAddress('2606:4700::1111') && !isPrivateAddress('::ffff:8.8.8.8'));
});

test('pageImage reads only the head, follows same-site redirects, refuses everything else', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    assert.equal(opts.redirect, 'manual');
    if (url.endsWith('/moved')) return new Response(null, { status: 301, headers: { location: '/2026/11/story/' } });
    if (url.endsWith('/away')) return new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.com/x' } });
    if (url.endsWith('/pdf')) return new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
    if (url.endsWith('/gone')) return new Response('no', { status: 404, headers: { 'content-type': 'text/html' } });
    if (url.endsWith('/huge')) return new Response('<html><head>' + ' '.repeat(400 * 1024) + '<meta property="og:image" content="https://cdn.example.org/far.jpg"></head>', { status: 200, headers: { 'content-type': 'text/html' } });
    return html('<meta property="og:image" content="/img/lead.jpg"><meta property="og:image:width" content="1600"><meta property="og:image:height" content="900">');
  };
  const opts = { fetchImpl, lookupImpl: publicDns };
  assert.deepEqual(await pageImage('https://desk.example.org/moved', SRC, opts), { image: { url: 'https://desk.example.org/img/lead.jpg', width: 1600, height: 900 } });
  assert.deepEqual(calls, ['https://desk.example.org/moved', 'https://desk.example.org/2026/11/story/']);
  assert.equal(await pageImage('https://desk.example.org/away', SRC, opts), null);
  assert.ok(!calls.some((u) => u.includes('elsewhere')));
  assert.equal(await pageImage('https://desk.example.org/pdf', SRC, opts), null);
  assert.equal(await pageImage('https://desk.example.org/gone', SRC, opts), null);
  // Past 256 KB without </head>, reading stops: a tag that far in is never seen.
  assert.deepEqual(await pageImage('https://desk.example.org/huge', SRC, opts), { image: null });
  // Off-site pages and names that resolve to private addresses are never fetched.
  const before = calls.length;
  assert.equal(await pageImage('https://other.example.com/story', SRC, opts), null);
  assert.equal(await pageImage('https://desk.example.org/story', SRC, { fetchImpl, lookupImpl: async () => [{ address: '10.0.0.7', family: 4 }] }), null);
  assert.equal(calls.length, before);
  // A fetch that throws (timeout, reset) is just no image.
  assert.equal(await pageImage('https://desk.example.org/story', SRC, { fetchImpl: async () => { throw new Error('timeout'); }, lookupImpl: publicDns }), null);
});

test('loadNews: og:image only for items without a feed image, and nothing at all for an outlet switched off', async () => {
  const oh = news.SOURCES.find((s) => s.id === 'ohiocapitaljournal');
  const feed = `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title>Feed picture story</title><link>https://ohiocapitaljournal.com/2026/11/16/a/</link><pubDate>${rfc(now - HOUR)}</pubDate>
      <media:content url="https://ohiocapitaljournal.com/wp-content/uploads/feed.jpg" medium="image" width="1024" height="683" /></item>
    <item><title>Page picture story</title><link>https://ohiocapitaljournal.com/2026/11/16/b/</link><pubDate>${rfc(now - 2 * HOUR)}</pubDate></item>
  </channel></rss>`;
  const pages = [];
  const fetchImpl = async (url) => {
    if (url === oh.feed) return { ok: true, text: async () => feed };
    if (url.startsWith('https://ohiocapitaljournal.com/2026/')) { pages.push(url); return html('<meta property="og:image" content="https://ohiocapitaljournal.com/wp-content/uploads/og.jpg">'); }
    return { ok: false, status: 503, text: async () => '' };
  };
  const out = await loadNews('OH', { fetchImpl, lookupImpl: publicDns, now, pageCache: false });
  assert.deepEqual(out.items.map((x) => x.image), [
    { url: 'https://ohiocapitaljournal.com/wp-content/uploads/feed.jpg', width: 1024, height: 683 },
    { url: 'https://ohiocapitaljournal.com/wp-content/uploads/og.jpg' },
  ]);
  assert.deepEqual(pages, ['https://ohiocapitaljournal.com/2026/11/16/b/']);
  assert.ok(JSON.stringify(out).length < 2000);
  oh.images = false;
  try {
    pages.length = 0;
    const off = await loadNews('OH', { fetchImpl, lookupImpl: publicDns, now, pageCache: false });
    assert.equal(off.items.length, 2);
    assert.ok(off.items.every((x) => x.image === null));
    assert.deepEqual(pages, []);
  } finally { oh.images = true; }
});

/* ---------- Preview images: the page's side (js/today.js) ---------- */

test('cleanImage keeps https pictures only, with a sensible size', () => {
  assert.deepEqual(cleanImage({ url: 'https://cdn.example.org/a.jpg', width: 1200, height: 800 }), { url: 'https://cdn.example.org/a.jpg', width: 1200, height: 800 });
  assert.deepEqual(cleanImage({ url: 'https://cdn.example.org/a.jpg' }), { url: 'https://cdn.example.org/a.jpg' });
  assert.deepEqual(cleanImage({ url: 'https://cdn.example.org/a.jpg', width: 'x' }), { url: 'https://cdn.example.org/a.jpg' });
  for (const url of ['http://cdn.example.org/a.jpg', 'data:image/png;base64,AA', 'javascript:alert(1)', 'https://cdn.example.org/a.svg', 'https://10.0.0.1/a.jpg', '', 'nonsense'])
    assert.equal(cleanImage({ url }), null, url);
  assert.equal(cleanImage({ url: 'https://cdn.example.org/p.gif', width: 1, height: 1 }), null);
  assert.equal(cleanImage(null), null);
  assert.equal(cleanImage('https://cdn.example.org/a.jpg'), null);
});

test('monogram and tile tone for the no-picture tile', () => {
  assert.equal(monogram('New York Focus'), 'NYF');
  assert.equal(monogram('City & State New York'), 'CSNY');
  assert.equal(monogram('The Texas Tribune'), 'TT');
  assert.equal(monogram('NPR Illinois'), 'NPR');
  assert.equal(monogram('WAMC'), 'WAMC');
  assert.equal(monogram('NJ Spotlight News'), 'NJSN');
  assert.equal(monogram('Pennsylvania Capital-Star'), 'PCS');
  assert.equal(monogram('CalMatters'), 'CM');
  assert.equal(monogram(''), '');
  assert.equal(tileTone('Ohio Capital Journal'), tileTone('Ohio Capital Journal'));
  assert.ok(['ink', 'concrete'].includes(tileTone('Anything')));
});

test('arrangeHeadlines: the newest story with a picture leads, three rows beside it, cards under', () => {
  const s = (id, image = null) => ({ id, image });
  const eight = [s(1), s(2, {}), s(3), s(4, {}), s(5), s(6), s(7), s(8)];
  const a = arrangeHeadlines(eight);
  assert.equal(a.lead.id, 2);
  assert.deepEqual(a.rows.map((x) => x.id), [1, 3, 4]);
  assert.deepEqual(a.cards.map((x) => x.id), [5, 6, 7, 8]);
  // No pictures at all: the newest story leads.
  assert.equal(arrangeHeadlines([s(1), s(2)]).lead.id, 1);
  // Four or fewer after the lead all sit beside it; five or more leave at least two cards.
  assert.deepEqual(arrangeHeadlines([s(1, {}), s(2), s(3), s(4), s(5)]).cards, []);
  assert.equal(arrangeHeadlines([s(1, {}), s(2), s(3), s(4), s(5), s(6)]).cards.length, 2);
  assert.deepEqual(arrangeHeadlines([]), { lead: null, rows: [], cards: [] });
  assert.deepEqual(arrangeHeadlines(null), { lead: null, rows: [], cards: [] });
});
