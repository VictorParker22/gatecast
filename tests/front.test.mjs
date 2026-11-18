// The weird-news front page's pure rules (js/frontmodel.js): what /api/weird returned, re-checked; the lead,
// "Also odd" and the grid; favourites from real votes only; datelines; the edition strip; the reader's own streak;
// the Weird-o-meter note; tip links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanItem, cleanWeird, catCounts, splitFront, gridFor, favourites, favCaption, favVotes, storyFor, FAV_MIN_VOTES, PAGE, catLabel, stickerTone, metaLine, shortMeta,
  ratingLabel, monogram, dayOfYear, editionLine, starPolygon, tickerSeconds, nextStreak, streakDigits, meterAngle, meterNote, tipUrl,
} from '../js/frontmodel.js';

const item = (n, extra = {}) => ({
  id: `s${n}`, title: `Story ${n}`, url: `https://www.upi.com/Odd_News/2026/11/13/story-${n}/`, outlet: 'UPI Odd News',
  published: `2026-11-${String(1 + (n % 15)).padStart(2, '0')}T12:00:00Z`, category: 'animals', image: null, imageCredit: null,
  video: false, pick: false, rating: null, note: null, ...extra,
});

test('cleanItem keeps only real, linkable stories and never fills in what is missing', () => {
  assert.equal(cleanItem({ ...item(1), url: 'http://upi.com/x' }), null, 'http only');
  assert.equal(cleanItem({ ...item(1), url: 'javascript:alert(1)' }), null);
  assert.equal(cleanItem({ ...item(1), title: '  ' }), null);
  assert.equal(cleanItem({ ...item(1), outlet: '' }), null);
  assert.equal(cleanItem({ ...item(1), published: 'yesterday' }), null);
  const x = cleanItem(item(1));
  assert.equal(x.note, null);
  assert.equal(x.rating, null);
  assert.equal(x.image, null);
  assert.equal(x.imageCredit, null);
  assert.equal(x.video, false);
  assert.equal(cleanItem({ ...item(1), category: 'gossip' }).category, 'other');
  assert.equal(cleanItem({ ...item(1), rating: 7 }).rating, null, 'out-of-range editor rating dropped');
  assert.equal(cleanItem({ ...item(1), rating: 4 }).rating, 4);
  assert.equal(cleanItem({ ...item(1), image: 'http://x.com/a.jpg' }).image, null);
  assert.equal(cleanItem({ ...item(1), image: 'https://x.com/a.svg' }).image, null);
  const im = cleanItem({ ...item(1), image: 'https://x.com/a.jpg' });
  assert.equal(im.image, 'https://x.com/a.jpg');
  assert.equal(im.imageCredit, 'Image: UPI Odd News', 'a picture is always credited');
  assert.equal(cleanItem({ ...item(1), video: 'yes' }).video, false, 'only a real true is a video');
});

test('cleanWeird keeps server order, drops duplicates and tolerates junk', () => {
  const w = cleanWeird({ items: [item(1, { pick: true }), item(2), item(1), null, 5], categories: { animals: 9 } });
  assert.deepEqual(w.items.map((x) => x.id), ['s1', 's2']);
  assert.equal(w.counts.all, 2);
  assert.equal(w.counts.animals, 9, "the server's counts are used when it sends them");
  assert.deepEqual(cleanWeird(null).items, []);
  assert.deepEqual(cleanWeird({ items: 'nope' }).items, []);
  assert.equal(catCounts(undefined, [cleanItem(item(1)), cleanItem(item(2, { category: 'laws' }))]).laws, 1);
});

test('lead, Also odd and grid never repeat a story; category filters show every story in the category', () => {
  const items = Array.from({ length: 20 }, (_, i) => cleanItem(item(i + 1, i % 3 === 0 ? { category: 'records' } : {})));
  const f = splitFront(items);
  assert.equal(f.lead.id, 's1');
  assert.deepEqual(f.also.map((x) => x.id), ['s2', 's3', 's4', 's5']);
  assert.equal(f.rest.length, 15);
  const g = gridFor(items, 'all');
  assert.equal(g.list.length, PAGE);
  assert.equal(g.left, 15 - PAGE);
  assert.ok(!g.list.some((x) => x === f.lead || f.also.includes(x)));
  assert.equal(gridFor(items, 'all', 100).left, 0);
  const rec = gridFor(items, 'records', 100);
  assert.equal(rec.total, items.filter((x) => x.category === 'records').length);
  assert.ok(rec.list.includes(f.lead), 'a category view includes the lead when it is in that category');
  const skip = splitFront(items, [items[1].url]);
  assert.deepEqual(skip.also.map((x) => x.id), ['s3', 's4', 's5', 's6'], 'favourites are skipped in Also odd');
  assert.deepEqual(splitFront([]), { lead: null, also: [], rest: [] });
});

test('favourites: the editor’s order until a story has 10 votes this week, then readers’ votes rank first', () => {
  const items = Array.from({ length: 8 }, (_, i) => cleanItem(item(i + 1, { pick: i === 0 || i === 3 || i === 5 || i === 6 })));
  const ids = Object.fromEntries(items.map((x, i) => [x.url, (i + 1).toString(16).padStart(16, '0')]));
  const id = (n) => ids[items[n - 1].url];

  // No votes: the editor's picks after the lead, in the order the server sent them.
  const ed = favourites(items, [], ids);
  assert.equal(ed.mode, 'editor');
  assert.deepEqual(ed.list.map((x) => x.id), ['s4', 's6', 's7'], 'the lead (s1) is never repeated');
  assert.ok(ed.list.every((x) => x.by === 'editor'));
  assert.deepEqual(favourites(items, undefined, undefined).list.map((x) => x.id), ['s4', 's6', 's7']);

  // Stories with 10+ votes this week come first, in the database's order (average, then votes); then the editor's.
  const favs = [
    { storyId: id(5), count: 64, average: 4.6 }, // not a pick: any weird story on the page can rank
    { storyId: id(6), count: 12, average: null },
    { storyId: id(1), count: 99, average: 5 }, // the lead: left out
    { storyId: id(2), count: 9, average: null }, // under 10 (a bad reply): never a reader favourite
    { storyId: 'ffffffffffffffff', count: 40, average: null }, // not on the page
  ];
  const r = favourites(items, favs, ids);
  assert.equal(r.mode, 'readers');
  assert.deepEqual(r.list.map((x) => [x.id, x.by]), [['s5', 'readers'], ['s6', 'readers'], ['s4', 'editor']]);
  assert.equal(r.list[0].votes, 64);
  assert.equal(r.list[0].average, 4.6);
  assert.equal(r.list[1].average, null, 'no average is invented under 50 votes');
  assert.equal(favourites(items, [{ storyId: id(3), count: 20, average: 4.1 }], ids).list[0].average, null, 'an average below 50 votes is never shown');
  assert.equal(favourites(items, favs, ids, 1).list.length, 1);
  assert.equal(FAV_MIN_VOTES, 10);

  // Nothing to show: no picks, no votes.
  assert.equal(favourites(items.map((x) => ({ ...x, pick: false })), [], ids).mode, 'none');
  assert.equal(favourites(items.map((x) => ({ ...x, pick: false })), [{ storyId: id(3), count: 10, average: null }], ids).mode, 'readers');
  assert.equal(favourites([], favs, ids).mode, 'none');
});

test('favourites caption: honest about who ranked the row', () => {
  const items = Array.from({ length: 6 }, (_, i) => cleanItem(item(i + 1, { pick: i === 2 || i === 4 })));
  const ids = Object.fromEntries(items.map((x, i) => [x.url, String(i).padStart(16, '0')]));
  const ed = favCaption(favourites(items, [], ids));
  assert.equal(ed.title, 'Editor’s favourites');
  assert.equal(ed.how, '');
  assert.match(ed.kicker, /EDITOR'S ORDER/);
  const mixed = favCaption(favourites(items, [{ storyId: ids[items[1].url], count: 10, average: null }], ids));
  assert.equal(`${mixed.title} — ${mixed.how}`, 'Reader favourites — ranked by Weird-o-meter votes');
  assert.match(mixed.kicker, /THEN THE EDITOR'S PICKS/);
  const all = favCaption(favourites(items.map((x) => ({ ...x, pick: false })), [{ storyId: ids[items[1].url], count: 10, average: null }], ids));
  assert.doesNotMatch(all.kicker, /EDITOR/);
  assert.equal(favVotes({ by: 'readers', votes: 12, average: null }), '12 VOTES THIS WEEK');
  assert.equal(favVotes({ by: 'readers', votes: 64, average: 4.62 }), '64 VOTES THIS WEEK · AVERAGE 4.6 OF 5');
  assert.equal(favVotes({ by: 'editor' }), '');
});

test('clicks are counted only for links to the page’s own weird stories', () => {
  const urls = new Set(['https://www.upi.com/Odd_News/2026/11/13/story-1/']);
  assert.equal(storyFor('https://www.upi.com/Odd_News/2026/11/13/story-1/', urls), 'https://www.upi.com/Odd_News/2026/11/13/story-1/');
  for (const other of ['https://www.upi.com/', 'https://www.thegatecast.com/#believe', 'how.html', '', null, undefined]) assert.equal(storyFor(other, urls), null, String(other));
  assert.equal(storyFor('https://www.upi.com/Odd_News/2026/11/13/story-1/', null), null);
});

test('labels, stickers and datelines', () => {
  assert.equal(catLabel('animals'), 'Strange animals');
  assert.equal(catLabel('nope'), 'Other oddities');
  for (const c of ['people', 'animals', 'laws', 'records', 'unexplained', 'weather', 'other']) assert.ok(['cobalt', 'sun', 'lime', 'card', 'ink'].includes(stickerTone(c)));
  const x = cleanItem(item(13, { published: '2026-11-13T15:00:00Z' }));
  assert.equal(metaLine(x, 'en-GB', 'UTC'), 'UPI ODD NEWS · FRI 13 NOV 2026');
  assert.equal(shortMeta(x, 'en-GB', 'UTC'), 'UPI ODD NEWS · 13 NOV');
  assert.equal(ratingLabel(null), null);
  assert.equal(ratingLabel(3), "Editor's weird rating: 3 out of 5");
  assert.equal(monogram('UPI Odd News'), 'UPI');
  assert.equal(monogram('Guinness World Records'), 'GWR');
  assert.equal(monogram('The Associated Press'), 'AP');
});

test('edition strip: place, date in the locale, Vol. 1, No. = day of the year', () => {
  const d = new Date(2026, 10, 16, 9);
  assert.equal(dayOfYear(d), 320);
  assert.equal(dayOfYear(new Date(2026, 0, 1)), 1);
  assert.equal(dayOfYear(new Date(2024, 11, 31)), 366);
  const e = editionLine('New York', d, 'en-GB');
  assert.equal(e.long, 'NEW YORK EDITION · MONDAY 16 NOVEMBER 2026 · VOL. 1 · NO. 320');
  assert.equal(e.short, 'MON 16 NOV 2026 · NEW YORK');
  assert.match(editionLine('', d, 'en-GB').long, /^TODAY'S EDITION · /);
  assert.match(editionLine('Paris', d, 'fr-FR').long, /^PARIS EDITION · LUNDI 16 NOVEMBRE 2026/);
});

test('starburst polygon, ticker speed', () => {
  const p = starPolygon(16, 38);
  assert.match(p, /^polygon\(/);
  assert.equal(p.split(',').length, 32);
  assert.ok(p.startsWith('polygon(50% 0%'));
  assert.equal(tickerSeconds(6000), 100);
  assert.equal(tickerSeconds(100), 20, 'never faster than 20 s a loop');
});

test('reading streak counts calendar days on this device only', () => {
  const day = (d) => new Date(2026, 10, d, 10);
  assert.deepEqual(nextStreak(null, day(16)), { last: '2026-11-16', days: 1 });
  assert.deepEqual(nextStreak({ last: '2026-11-15', days: 3 }, day(16)), { last: '2026-11-16', days: 4 });
  assert.deepEqual(nextStreak({ last: '2026-11-16', days: 4 }, day(16)), { last: '2026-11-16', days: 4 }, 'same day does not add');
  assert.deepEqual(nextStreak({ last: '2026-11-10', days: 9 }, day(16)), { last: '2026-11-16', days: 1 }, 'a gap starts again');
  assert.deepEqual(nextStreak({ last: 5, days: 'x' }, day(16)).days, 1);
  assert.deepEqual(streakDigits(3), ['0', '0', '0', '3']);
  assert.deepEqual(streakDigits(123456), ['9', '9', '9', '9']);
});

test('Weird-o-meter: needle and an honest note (average only from 50 votes)', () => {
  assert.equal(meterAngle(0), -90);
  assert.equal(meterAngle(1), -90);
  assert.equal(meterAngle(3), 0);
  assert.equal(meterAngle(5), 90);
  assert.match(meterNote({}), /Tap a number\. Readers' average shows after 50 votes\./);
  assert.match(meterNote({ yours: 4, count: 12, average: null }), /You said: very weird \(4 of 5\)\. 12 votes so far\. Readers' average shows after 50 votes\./);
  assert.match(meterNote({ count: 60, average: 3.456 }), /Readers' average: 3\.5 of 5 from 60 votes\./);
  assert.doesNotMatch(meterNote({ count: 20, average: 4 }), /average: /, 'a stray average under 50 votes is not shown');
});

test('tip links: https only, never our own pages', () => {
  assert.equal(tipUrl(' https://www.upi.com/Odd_News/x '), 'https://www.upi.com/Odd_News/x');
  assert.equal(tipUrl('http://www.upi.com/x'), null);
  assert.equal(tipUrl('upi.com/x'), null);
  for (const own of ['https://www.thegatecast.com/', 'https://www.thegatecast.com/how.html', 'https://gatecast.vercel.app/']) assert.equal(tipUrl(own), null, own);
  assert.equal(tipUrl('https://www.thegatecast.com.example.org/x'), 'https://www.thegatecast.com.example.org/x', 'another site whose name starts the same way');
  assert.equal(tipUrl(''), null);
});
