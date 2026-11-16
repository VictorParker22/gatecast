import test from 'node:test';
import assert from 'node:assert/strict';
import { alertItems, alertReason, newsReason, civicReason, airportSignal, cleanHeadlines } from '../js/today.js';
import { assessWindow, HOUR } from '../js/core.js';

const now = Date.UTC(2026, 11, 2, 15); // 08:00 in Denver
const when = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const DENVER = { name: 'Denver', region: 'Colorado, United States', country: 'US' };

test('alert reasons name the alert, the place, its end and a departure it covers', () => {
  const [a] = alertItems([{ event: 'Winter Storm Warning', severity: 'Severe', onset: new Date(now - HOUR).toISOString(), ends: new Date(now + 10 * HOUR).toISOString() }], now);
  assert.equal(alertReason(a, DENVER, when, null, now), 'Because a Winter Storm Warning covers Denver until 18:00.');
  assert.equal(alertReason(a, DENVER, when, { t: now + 8 * HOUR + 10 * 60e3, code: 'DEN' }, now),
    'Because a Winter Storm Warning covers Denver until 18:00, during your 16:10 departure from DEN.');
  // A departure after the alert ends is not mentioned.
  assert.equal(alertReason(a, DENVER, when, { t: now + 12 * HOUR, code: 'DEN' }, now), 'Because a Winter Storm Warning covers Denver until 18:00.');
  const [b] = alertItems([{ event: 'Ice Storm Watch', severity: 'Moderate', onset: new Date(now + 2 * HOUR).toISOString() }], now);
  assert.equal(alertReason(b, { name: 'Your location' }, when, null, now), 'Because an Ice Storm Watch covers where you are from 10:00.');
});

test('headline and civic reasons follow how the page chose them', () => {
  assert.equal(newsReason({ name: 'New York' }, true, 'NY', 'NY'), 'Because you’re in New York. Newest first, from newsrooms we check there.');
  assert.equal(newsReason(DENVER, true, 'CO', 'CO'), 'Because Denver is in Colorado. Newest first, from newsrooms we check there.');
  assert.match(newsReason({ name: 'London' }, false, null, null), /^Because we check state newsrooms only in the US/);
  assert.match(newsReason({ name: 'Boise' }, true, 'ID', null), /no newsrooms listed for Idaho/);
  assert.match(newsReason({ name: 'Somewhere' }, true, null, null), /could not tell which state/);
  assert.match(civicReason(DENVER, 'CO'), /^Because Denver is in Colorado\. Votes are listed newest first/);
  assert.equal(civicReason(DENVER, null), '');
});

test('the nearby-airport item says how far and what', () => {
  const hours = [0, 1, 2, 3].map((k) => ({ t: now + k * HOUR, code: 2, gust: 60, vis: 20000 }));
  const sig = airportSignal([{ code: 'DEN', km: 24, risk: assessWindow(hours, now, now + 3 * HOUR) }], (km) => `${km} km`);
  assert.equal(sig.because, 'Because DEN is 24 km from you and the forecast shows strong gusts there in the next 3 hours.');
});

test('headlines are ordered by publish time only', () => {
  const item = (title, published) => ({ title, outlet: 'X', url: `https://x.example/${title}`, published });
  const got = cleanHeadlines({ items: [item('old', '2026-12-01T10:00:00Z'), item('new', '2026-12-02T10:00:00Z'), item('mid', '2026-12-01T20:00:00Z')] });
  assert.deepEqual(got.map((x) => x.title), ['new', 'mid', 'old']);
});
