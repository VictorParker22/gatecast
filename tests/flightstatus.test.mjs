import test from 'node:test';
import assert from 'node:assert/strict';
import { normFlight, flightNames, freshness, endsVerdict } from '../js/flightstatus.js';

test('flight numbers normalise without spaces or leading zeros', () => {
  assert.equal(normFlight('ba 0117'), 'BA117');
  assert.equal(normFlight('QY 6741'), 'QY6741');
  assert.equal(normFlight('BCS6741'), 'BCS6741');
});

test('the searched number leads and the airline number follows only when it differs', () => {
  assert.deepEqual(flightNames('BCS6741', { flight: 'QY 6741', callsign: 'BCS6741' }), { primary: 'BCS6741', alias: 'Shown by the airline as QY 6741' });
  // Same as the airline number: fall back to the callsign, quietly.
  assert.deepEqual(flightNames('BA117', { flight: 'BA 117', callsign: 'BAW117' }), { primary: 'BA117', alias: 'Radio callsign BAW117' });
  assert.deepEqual(flightNames('BA0117', { flight: 'BA 117', callsign: 'BAW117' }).alias, 'Radio callsign BAW117');
  // Airline without an IATA code: the flight is the callsign, so there is nothing to add.
  assert.deepEqual(flightNames('XYZ12', { flight: 'XYZ 12', callsign: 'XYZ12' }), { primary: 'XYZ12', alias: null });
});

test('freshness says Live, then when it last updated, then stops claiming live', () => {
  assert.deepEqual(freshness(3), { live: true, stale: false, text: '' });
  assert.equal(freshness(60).text, 'updated just now');
  assert.equal(freshness(130).text, 'updated 2 min ago');
  assert.equal(freshness(130).live, true);
  assert.equal(freshness(900).live, false);
  assert.equal(freshness(900).text, 'last position 15 min ago');
  assert.equal(freshness(null).live, true);
});

test('calm ends collapse to one line; risk names the airport, worst first', () => {
  const lhr = { code: 'LHR', level: 'low', when: 'now' };
  const bru = { code: 'BRU', level: 'low', when: 'landing' };
  assert.equal(endsVerdict([lhr, bru]).kind, 'calm');
  assert.equal(endsVerdict([lhr, bru]).title, 'Both ends look calm');
  const v = endsVerdict([lhr, { ...bru, level: 'elevated' }]);
  assert.equal(v.kind, 'risk');
  assert.equal(v.title, 'Elevated weather risk at BRU around landing');
  assert.equal(v.order[0].code, 'BRU');
  assert.equal(endsVerdict([{ ...lhr, level: 'high' }, { ...bru, level: 'elevated' }]).title, 'High weather risk at LHR right now');
  assert.equal(endsVerdict([{ ...lhr, level: 'high' }, { ...bru, level: 'high' }]).title, 'High weather risk at both ends');
  assert.equal(endsVerdict([{ ...lhr, level: 'unknown' }, { ...bru, level: 'unknown' }]).kind, 'unknown');
  assert.equal(endsVerdict([lhr, { ...bru, level: 'unknown' }]).title, 'LHR looks calm; no forecast for BRU');
  assert.equal(endsVerdict([{ code: 'JFK', level: 'low', when: 'next3h' }]).title, 'JFK looks calm for the next 3 hours');
  assert.equal(endsVerdict([{ code: 'JFK', level: 'high', when: 'next3h' }]).title, 'High weather risk at JFK in the next 3 hours');
});
