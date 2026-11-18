// The written parts of The Stacks: the shelf introductions (data/shelf-intros.json), Gatecast's take on a book
// (`take` and `takeDate` in data/books.json, first Skyjack) and the "How the books are chosen" section of how.html,
// with the links to it. Lengths, house style, that each intro names books really on its shelf, the true-crime
// policy line, and how the generator shows them (scripts/build-stacks-pages.cjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const S = require('../scripts/build-stacks-pages.cjs');
const B = require('../scripts/build-data.cjs');
const raw = JSON.parse(read('data/books.json'));
const INTROS = JSON.parse(read('data/shelf-intros.json'));
const data = S.stocked(raw);
const m = await S.loadModel();
const pages = new Map(S.renderStacks(data, m).map((p) => [p.id, p.html]));
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// The house style for anything a reader sees: no exclamation marks, straight quotes or emoji; British spellings.
function styleProblems(text) {
  const out = [];
  if (/!/.test(text)) out.push('exclamation mark');
  if (/["']/.test(text)) out.push('straight quote (use “ ” and ’)');
  if (/\p{Extended_Pictographic}/u.test(text)) out.push('emoji');
  for (const us of ['color', 'favorite', 'center', 'criticized', 'organization', 'gray area', 'behavior', 'theater']) if (new RegExp(`\\b${us}`, 'i').test(text)) out.push(`US spelling: ${us}`);
  if (/\byou won’t believe|\bshocking\b|\bmust-read\b|\bunmissable\b/i.test(text)) out.push('clickbait');
  return out;
}

const VICTIM_SHELVES = ['crime', 'serial', 'unsolved', 'cults'];

test('every stocked shelf has an introduction, title and description within their limits', () => {
  assert.equal(S.INTRO_TITLE_MAX, 60);
  assert.equal(S.INTRO_MIN_WORDS, 120);
  assert.equal(S.INTRO_MAX_WORDS, 250);
  assert.deepEqual(Object.keys(INTROS.shelves).sort(), data.shelves.map((s) => s.id).sort(), 'one entry per shelf, no strays');
  assert.equal(data.shelves.length, 8);
  for (const s of data.shelves) {
    const e = INTROS.shelves[s.id];
    assert.ok(e.title.length <= 60, `${s.id}: title is ${e.title.length} characters`);
    assert.ok(e.title.endsWith(' · Gatecast'), `${s.id}: title ends with the site name`);
    assert.ok(e.description.length >= 70 && e.description.length <= 155, `${s.id}: description is ${e.description.length} characters`);
    assert.match(e.updated, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(e.intro) && e.intro.length >= 2, `${s.id}: paragraphs`);
    const words = S.wordCount(e.intro.join(' '));
    assert.ok(words >= 120 && words <= 250, `${s.id}: intro is ${words} words`);
    for (const t of [e.title, e.description, ...e.intro]) assert.deepEqual(styleProblems(t), [], `${s.id}: "${t.slice(0, 60)}…"`);
  }
  assert.deepEqual(S.contentErrors({ ...data, intros: INTROS }), [], 'the build accepts them');
});

test('each introduction points a newcomer to two or three books that are really on that shelf', () => {
  const titles = new Map(raw.books.map((b) => [b.title, b.shelf]));
  for (const s of data.shelves) {
    const text = INTROS.shelves[s.id].intro.join(' ');
    const named = [...titles.keys()].filter((t) => text.includes(t));
    const here = named.filter((t) => titles.get(t) === s.id);
    assert.ok(here.length >= 2, `${s.id}: names ${here.length} of its own books`);
    assert.deepEqual(named.filter((t) => titles.get(t) !== s.id && !here.some((h) => h.includes(t))), [], `${s.id}: no book from another shelf`);
    assert.match(text, /\b(start|begin|starting out|way in)\b/i, `${s.id}: says where to start`);
  }
});

test('the true-crime policy is stated on every shelf about real crimes, in the library’s words', () => {
  const lib = read('library.html');
  assert.ok(lib.includes('True-crime shelves focus on the cases and the people who solved them, never on making killers famous.'));
  for (const id of VICTIM_SHELVES) {
    const text = INTROS.shelves[id].intro.join(' ');
    assert.match(text, /victims?|people harmed/, `${id}: the victims`);
    assert.match(text, /never (to make|on making|making) (a )?killers? famous/, `${id}: never to make killers famous`);
  }
  // The fiction shelves say they are fiction; the true-story shelves don't claim the whole library is true.
  for (const id of ['fantasy', 'scifi']) assert.match(INTROS.shelves[id].intro[0], /made-up stories/, id);
  for (const s of data.shelves) assert.ok(!/every book in The Stacks is true|only true stories/i.test(INTROS.shelves[s.id].intro.join(' ')), s.id);
  // No killer's name in a shelf page's title or description (the strategy's naming rule).
  for (const name of ['Bundy', 'Manson', 'Holmes', 'Sutcliffe', 'Gilmore', 'Cullen', 'DeAngelo', 'Zodiac Killer', 'Jones']) {
    for (const e of Object.values(INTROS.shelves)) assert.ok(!e.title.includes(name) && !e.description.includes(name), `${name} in a title or description`);
  }
});

test('shelf pages show the introduction under the note, then the count, in its own paragraphs', () => {
  for (const s of data.shelves) {
    const h = pages.get(s.id);
    const e = INTROS.shelves[s.id];
    const block = h.split('<div class="stk-intro grid gap-3">')[1].split('</div>')[0];
    assert.deepEqual([...block.matchAll(/<p>([^<]*)<\/p>/g)].map((x) => decode(x[1])), e.intro);
    assert.ok(h.indexOf('class="stk-lede"') < h.indexOf('<div class="stk-intro'), `${s.id}: after the note`);
    assert.ok(h.indexOf('<div class="stk-intro') < h.indexOf(S.shelfIntro(data.books.filter((b) => b.shelf === s.id))), `${s.id}: before the count`);
    const ld = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(ld.description, e.description, `${s.id}: CollectionPage description`);
  }
});

test('the build refuses a take or an introduction outside its limits', () => {
  const sky = raw.books.find((b) => b.id === 'skyjack');
  const errs = (books, intros = INTROS) => S.contentErrors({ ...data, books, intros });
  assert.match(errs([{ ...sky, takeDate: undefined }]).join(), /takeDate must be a date/);
  assert.match(errs([{ ...sky, take: 'word '.repeat(301) }]).join(), /at most 300/);
  const e = INTROS.shelves.crime;
  assert.match(errs([], { shelves: { crime: { ...e, title: 'x'.repeat(61) } } }).join(), /title must be/);
  assert.match(errs([], { shelves: { crime: { ...e, description: 'x'.repeat(156) } } }).join(), /description must be/);
  assert.match(errs([], { shelves: { crime: { ...e, intro: ['Too short.'] } } }).join(), /intro must be/);
  assert.match(errs([], { shelves: { nowhere: e } }).join(), /not a shelf/);
  assert.deepEqual(errs([], { shelves: {} }), [], 'a shelf may have no introduction yet');
});

/* ---------- Skyjack: the first take ---------- */

const sky = raw.books.find((b) => b.id === 'skyjack');

test('Skyjack: the book is Geoffrey Gray’s, 2011, on Unsolved Mysteries, with a dated take of 200 to 300 words', () => {
  assert.equal(sky.title, 'Skyjack');
  assert.deepEqual(sky.authors, ['Geoffrey Gray']);
  assert.equal(sky.year, 2011);
  assert.equal(sky.shelf, 'unsolved');
  assert.match(sky.takeDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(sky.takeDate <= '2026-11-24', 'written before the anniversary it is published for');
  const words = S.wordCount(sky.take);
  assert.ok(words >= 200 && words <= S.TAKE_MAX_WORDS, `${words} words`);
  assert.equal(S.takeParagraphs(sky).length, 4);
  assert.deepEqual(styleProblems(sky.take), []);
});

test('Skyjack: the take keeps to the record (date, unsolved, the FBI in 2016) and quotes nobody', () => {
  const t = sky.take;
  assert.ok(t.includes('24 November 1971'), 'the date of the hijacking');
  assert.ok(t.includes('officially unsolved'));
  assert.ok(t.includes('In 2016 the FBI said it had stopped actively investigating'));
  assert.ok(t.includes('never identified the hijacker'));
  assert.ok(t.includes('No one aboard was hurt'), 'the people aboard, not only the hijacker');
  assert.match(t, /theory, not an answer/, 'no suspect is presented as the culprit');
  assert.ok(!/[“”"]/.test(t), 'no quotations');
  assert.ok(!/\b(was|is) (really|in fact|actually) (named|called)\b|\bsolved the case\b|\bthe real D\. B\. Cooper\b/i.test(t), 'names no one as Cooper');
  for (const title of ['Ghost Ship', 'Dead Mountain']) assert.equal(raw.books.find((b) => b.title === title).shelf, 'unsolved', `${title} is on the same shelf`);
});

test('Skyjack: its page is indexed, shows Gatecast’s take with its date, and is in the sitemap', () => {
  const h = pages.get('skyjack');
  assert.ok(!h.includes('name="robots"'), 'no noindex');
  assert.ok(S.indexable(sky));
  const sec = h.match(/<section class="stk-take" aria-labelledby="take-title">([\s\S]*?)<\/section>/)[1];
  assert.ok(sec.includes('<h2 id="take-title" class="stk-take__title">Gatecast’s take</h2>'));
  const paras = [...sec.matchAll(/<p>([^<]*)<\/p>/g)].map((x) => decode(x[1]));
  assert.deepEqual(paras, S.takeParagraphs(sky));
  assert.ok(sec.includes(`Written <time datetime="${sky.takeDate}">${S.longDate(sky.takeDate)}</time>`));
  assert.equal(S.longDate('2026-11-17'), '17 November 2026');
  assert.equal(S.longDate('nope'), null);
  // After the description and notes, before the topics.
  assert.ok(h.indexOf('class="stk-desc"') < h.indexOf('class="stk-take"') && h.indexOf('class="stk-take"') < h.indexOf('class="stk-tags"'));
  const xml = B.sitemapXml({ dateOf: () => null, day: '2099-01-01' });
  assert.ok(xml.includes(`<url><loc>https://www.thegatecast.com/stacks/skyjack/</loc><lastmod>${S.bookLastmod(sky, raw)}</lastmod></url>`));
  assert.equal(S.bookLastmod(sky, raw), [raw.checked, sky.cover.checked, sky.takeDate].sort().pop());
});

/* ---------- How the books are chosen (how.html) and the links to it ---------- */

test('how.html has a "How the books are chosen" section, listed on the page, that matches the code', () => {
  const how = read('how.html');
  const sec = how.match(/<section class="doc-section" id="books" aria-labelledby="books-title">([\s\S]*?)<\/section>/);
  assert.ok(sec, 'the section, with id="books"');
  const s = sec[1];
  assert.ok(s.includes('<h2 id="books-title">How the books are chosen</h2>'));
  assert.ok(how.includes('href="#books">How the books are chosen</a>'), 'in the table of contents');
  assert.equal((how.match(/id="books"/g) || []).length, 1);
  const text = decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  assert.deepEqual(styleProblems(text.replace(/["']/g, '')), []);
  // The policy, in the same words as the library and books.json.
  assert.ok(text.includes('chosen for the investigation and the victims, never to make killers famous'));
  assert.ok(raw.comment.includes('chosen for the investigation and the victims, never to make killers famous'));
  // The fiction shelves are named as fiction, by their real names.
  for (const id of ['fantasy', 'scifi']) {
    const sh = raw.shelves.find((x) => x.id === id);
    assert.equal(sh.fiction, true);
    assert.ok(text.includes(sh.name), `${sh.name} named`);
  }
  // The links it describes are the ones the code builds: WorldCat search, a plain Bookshop.org search, Open Library.
  assert.equal(m.BOOKSHOP_AFFILIATE, null, 'no affiliate, so the section may say the Bookshop.org link is plain');
  assert.match(m.worldcatUrl(sky), /^https:\/\/search\.worldcat\.org\/search\?q=/);
  assert.match(m.bookshopUrl(sky), /^https:\/\/bookshop\.org\/search\?keywords=/);
  for (const w of ['WorldCat', 'Bookshop.org', 'Open Library', 'not an affiliate link']) assert.ok(text.includes(w), w);
  // What it says about suggestions and the stand-in covers is what the library does.
  assert.ok(text.includes('Suggested by the author') && text.includes('Suggested by the publisher'));
  assert.ok(m.NO_COVER.has('helter-skelter') && text.includes('stand-in'));
  assert.ok(read('js/library.js').includes('const offered = shelves.filter((sh) => !sh.fiction);'), 'only true-story shelves take suggestions');
  assert.ok(text.includes('true-story shelves'));
  for (const id of ['put-forward', 'book-of-the-week', 'previews']) assert.ok(s.includes(`href="#${id}"`) && how.includes(`id="${id}"`), `links #${id}`);
  // Honest about how the shelf introductions and takes are written.
  assert.ok(text.includes('AI assistant (Claude, made by Anthropic)'));
});

test('the library footer and every /stacks/ page link to How the books are chosen', () => {
  const lib = read('library.html');
  const foot = lib.match(/<footer class="lib-footer">([\s\S]*?)<\/footer>/)[1];
  assert.equal((foot.match(/href="how\.html#books"/g) || []).length, 1);
  assert.ok(foot.includes('<a href="how.html#books">How the books are chosen</a>'));
  for (const [id, h] of pages) {
    const f = h.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)[1];
    assert.ok(f.includes('<a href="/how.html#books">How the books are chosen</a>'), `${id ?? 'index'}: footer link`);
  }
  assert.ok(S.UI_TEXT.includes('How the books are chosen'));
});
