// FAA "planned for today": the plan-line parser and the airport-events reader in lib/live.js.
// Samples are the FAA's own public NAS Status responses, fetched on 16 Nov 2026 (trimmed, not edited).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parsePlanLine, parseOpsPlan, parseAirportEvents, faaPlansFor, faaPlanAirports } = require('../lib/live.js');

const DAY = { y: 2026, m: 11, d: 16 };
const OPS_PLAN = {
  link: 'https://www.fly.faa.gov/adv/adv_otherdis.jsp?advn=32&adv_date=11162026&facId=ATCSCC&title=ATCSCC ADVZY 032 DCC 11/16/2026 OPERATIONS PLAN&titleDate=11/16/2026',
  terminalPlanned: [{ time: '', event: 'AFTER 1700\t-SAN GROUND STOP/DELAY PROGRAM EXPECTED' }],
  enRoutePlanned: [{ time: '', event: 'UNTIL 2200\t-NO Q34 FOR TEB/MMU/CDW POSSIBLE' }],
};
const EVENTS = [
  { airportId: 'ABQ', groundStop: null, groundDelay: null, airportClosure: null, freeForm: null, arrivalDelay: null, departureDelay: null, airportConfig: null,
    deicing: { id: 'c00ae39e-b86e-4a5b-afd8-3657d3bb340c', createdAt: '2026-11-16T12:52:35Z', airportId: 'ABQ', updatedAt: '2026-11-16T12:52:35Z', eventTime: '2026-11-16T12:51:00Z', expTime: '2026-11-17T07:59:59Z' },
    airportLongName: 'Albuquerque International Sunport', latitude: '35.0432', longitude: '-106.6129' },
  { airportId: 'LAS', groundStop: null, groundDelay: null, airportClosure: null,
    freeForm: { airportId: 'LAS', startTime: '2026-10-28T19:26:00Z', endTime: '2027-01-27T23:00:00Z', simpleText: '!LAS 10/160 LAS AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR 702-261-7775 2610281926-2701272300', text: 'TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR 702-261-7775' },
    airportConfig: { airportId: 'LAS', arrivalRunwayConfig: '19R/26L', departureRunwayConfig: '19L/26R', arrivalRate: 56 }, deicing: null },
  { airportId: 'SAN', groundStop: null, airportClosure: null, freeForm: null, deicing: null,
    groundDelay: { airportId: 'SAN', impactingCondition: 'airport volume', avgDelay: 36.0, maxDelay: 72, startTime: '2026-11-16T17:00:00Z', endTime: '2026-11-16T21:59:00Z', center: 'ZLA',
      advisoryUrl: 'https://www.fly.faa.gov/adv/adv_otherdis.jsp?advn=35&adv_date=11162026&facId=SAN&title=ATCSCC ADVZY 035 SAN/ZLA 11/16/2026 CDM GROUND DELAY PROGRAM&titleDate=11/16/2026' } },
  { airportId: 'SNA', groundStop: null, groundDelay: null, deicing: null,
    airportClosure: { airportId: 'SNA', startTime: '2026-11-15T07:30:00Z', endTime: '2026-11-21T14:15:00Z', simpleText: '!SNA 11/020 SNA AD AP CLSD DLY 0730-1415 2611150730-2611211415', text: 'DLY 0730-1415' } },
];
const NOW = Date.parse('2026-11-16T15:48:00Z');

test('the real 16 Nov plan line: a ground stop or delay program at SAN after 17:00 Zulu', () => {
  const x = parsePlanLine(OPS_PLAN.terminalPlanned[0], DAY);
  assert.deepEqual(x.codes, ['SAN']);
  assert.equal(x.kind, 'ground_stop');
  assert.equal(x.likelihood, 'expected');
  assert.equal(x.text, 'AFTER 1700 -SAN GROUND STOP/DELAY PROGRAM EXPECTED');
  assert.equal(x.summary, 'Ground stop or delay program expected');
  assert.equal(x.start, '2026-11-16T17:00:00.000Z');
  assert.equal(x.end, null);
});

test('plan times: UNTIL is an end, a range is both, early-hours times fall on the next UTC day', () => {
  const until = parsePlanLine({ time: '', event: 'UNTIL 2200\t-NO Q34 FOR TEB/MMU/CDW POSSIBLE' }, DAY);
  assert.deepEqual(until.codes, ['TEB', 'MMU', 'CDW']);
  assert.equal(until.start, null);
  assert.equal(until.end, '2026-11-16T22:00:00.000Z');
  assert.equal(until.kind, 'other');
  const range = parsePlanLine({ time: '1400-2000', event: '-EWR/LGA/JFK GROUND DELAY PROGRAM POSSIBLE' }, DAY);
  assert.deepEqual(range.codes, ['EWR', 'LGA', 'JFK']);
  assert.equal(range.kind, 'delay_program');
  assert.equal(range.summary, 'Delay program possible');
  assert.equal(range.start, '2026-11-16T14:00:00.000Z');
  assert.equal(range.end, '2026-11-16T20:00:00.000Z');
  const late = parsePlanLine({ time: '', event: '2200-0300 -ORD/MDW GROUND STOP PROBABLE' }, DAY);
  assert.equal(late.summary, 'Ground stop probable');
  assert.equal(late.start, '2026-11-16T22:00:00.000Z');
  assert.equal(late.end, '2026-11-17T03:00:00.000Z');
  const none = parsePlanLine({ event: '-BOS GROUND DELAY PROGRAM PLANNED' }, DAY);
  assert.deepEqual([none.codes, none.start, none.end, none.likelihood], [['BOS'], null, null, 'planned']);
});

test('plan lines: unknown shapes and empty lines do not throw', () => {
  assert.equal(parsePlanLine(null, DAY), null);
  assert.equal(parsePlanLine({ time: '', event: '   ' }, DAY), null);
  const noDay = parsePlanLine({ event: 'AFTER 1700 -SAN GROUND STOP POSSIBLE' }, null);
  assert.equal(noDay.start, null); // no plan date: no invented time
  assert.deepEqual(parseOpsPlan(null), { link: null, items: [] });
  assert.deepEqual(parseOpsPlan({ terminalPlanned: 'x' }).items, []);
  assert.deepEqual(parseAirportEvents({ not: 'a list' }), []);
});

test('the operations plan keeps terminal lines only, dated from its advisory link', () => {
  const p = parseOpsPlan(OPS_PLAN);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].start, '2026-11-16T17:00:00.000Z');
  assert.match(p.link, /^https:\/\/www\.fly\.faa\.gov\/.*ADVZY%20032/);
});

test('airport events: programs and de-icing kept, NOTAM closures and free-form rows dropped', () => {
  const ev = parseAirportEvents(EVENTS);
  assert.deepEqual(ev.map((x) => `${x.codes[0]}:${x.kind}`), ['ABQ:deicing', 'SAN:delay_program']);
  const gdp = ev[1];
  assert.equal(gdp.text, 'Ground delay program (airport volume), average delay 36 min, up to 72 min');
  assert.equal(gdp.start, '2026-11-16T17:00:00.000Z');
  assert.equal(gdp.end, '2026-11-16T21:59:00.000Z');
  assert.match(gdp.link, /ADVZY%20035/);
});

test('plans for airports: an issued program replaces the plan line; ICAO and IATA both match; ended items go', () => {
  const raw = { plan: parseOpsPlan(OPS_PLAN), events: parseAirportEvents(EVENTS) };
  const plans = faaPlansFor([{ code: 'SAN', icao: 'KSAN' }, { code: 'ABQ', icao: 'KABQ' }, { code: 'JFK', icao: 'KJFK' }], raw, NOW);
  assert.deepEqual(plans.map((p) => [p.airport, p.kind, p.status, p.from]), [['SAN', 'delay_program', 'planned', 'airport-events'], ['ABQ', 'deicing', 'active', 'airport-events']]);
  assert.ok(plans.every((p) => p.source === 'FAA NAS Status'));
  // Without the events, the plan line itself is what SAN gets.
  const planOnly = faaPlansFor([{ code: 'SAN', icao: 'KSAN' }], { plan: raw.plan, events: null }, NOW);
  assert.equal(planOnly.length, 1);
  assert.equal(planOnly[0].summary, 'Ground stop or delay program expected');
  assert.equal(planOnly[0].from, 'operations-plan');
  assert.match(planOnly[0].link, /OPERATIONS%20PLAN/);
  // After the program has ended nothing is left.
  assert.equal(faaPlansFor([{ code: 'SAN', icao: 'KSAN' }], { plan: null, events: raw.events }, Date.parse('2026-11-16T23:00:00Z')).length, 0);
});

test('airport codes are validated and kept to US airports', () => {
  assert.deepEqual(faaPlanAirports('jfk, LGA,KORD,LHR,EGLL,12,<x>,JFK').map((a) => a.code), ['JFK', 'LGA', 'ORD']);
  assert.deepEqual(faaPlanAirports(''), []);
  assert.deepEqual(faaPlanAirports('SJU').map((a) => a.code), ['SJU']); // Puerto Rico is in the FAA's system
});
