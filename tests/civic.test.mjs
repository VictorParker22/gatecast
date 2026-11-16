import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stateCode, votesPath, topicsPath, safeUrl, hostOf, fmtDate, chamberLabel, partyLine, voteModel, votesModel,
  topicModel, topicsModel,
} from '../js/civicmodel.js';

// A real row from public.state_votes (Ohio House, 10 Nov 2026), trimmed to the fields the site reads.
const OH = {
  state: 'OH', bill_identifier: 'HB 397', bill_title: 'Expand allowable uses of profits from jail commissary funds',
  chamber: 'lower', chamber_name: 'House', motion: 'Concurred in Senate amendments',
  voted_at: '2026-11-11T03:07:43+00:00', voted_on: '2026-11-10', passed: true, yes: 71, no: 22, other: 0,
  dem_yes: 11, dem_no: 21, dem_other: 0, rep_yes: 58, rep_no: 0, rep_other: 0, oth_yes: 0, oth_no: 0, oth_other: 0,
  party_unknown: 3,
  record_url: 'https://search-prod.lis.state.oh.us/api/v2/general_assembly_136/legislation/hb397/actions',
  openstates_url: 'https://openstates.org/oh/bills/136/HB397/',
};

test('state codes: known two-letter codes only, any case', () => {
  assert.equal(stateCode('oh'), 'OH');
  assert.equal(stateCode(' ne '), 'NE');
  assert.equal(stateCode('XX'), null);
  assert.equal(stateCode(null), null);
  assert.equal(stateCode('constructor'), null);
});

test('query paths', () => {
  assert.match(votesPath('oh'), /^state_votes\?select=[a-z_,]+&state=eq\.OH&order=voted_at\.desc&limit=6$/);
  assert.equal(votesPath(null), null);
  assert.equal(votesPath('ZZ'), null);
  assert.equal(topicsPath('OH'), 'topics?select=*,statements(*)&status=eq.published&place=in.(US,OH)&order=published_at.desc&limit=2');
  assert.equal(topicsPath(null), 'topics?select=*,statements(*)&status=eq.published&place=eq.US&order=published_at.desc&limit=2');
});

test('links: only http(s) gets through', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('not a url'), null);
  assert.equal(safeUrl(undefined), null);
  assert.equal(safeUrl('http://leginfo.legislature.ca.gov/x'), 'http://leginfo.legislature.ca.gov/x');
  assert.equal(hostOf('https://www.eia.gov/petroleum/gasdiesel/'), 'eia.gov');
  assert.equal(hostOf('ftp://x'), '');
});

test('dates read as written, not shifted by time zone', () => {
  assert.equal(fmtDate('2026-11-10'), '10 Nov 2026');
  assert.equal(fmtDate('2026-01-05T23:30:00-08:00'), '5 Jan 2026');
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDate('2026-13-01'), '');
});

test('party split text', () => {
  assert.equal(partyLine('Democrats', 11, 21), 'Democrats 11 yes · 21 no');
  assert.equal(partyLine('Republicans', 58, 0, 0), 'Republicans 58 yes · 0 no');
  assert.equal(partyLine('Democrats', 21, 0, 9), 'Democrats 21 yes · 0 no · 9 not voting');
  assert.equal(partyLine('Republicans', null, undefined, -2), 'Republicans 0 yes · 0 no');
});

test('a real Ohio House vote', () => {
  const v = voteModel(OH);
  assert.equal(v.bill, 'HB 397');
  assert.equal(v.title, OH.bill_title); // the official title, untouched
  assert.equal(v.chamber, 'Ohio House');
  assert.equal(v.date, '10 Nov 2026');
  assert.equal(v.outcome, 'Passed');
  assert.equal(v.tally, '71–22');
  assert.equal(v.tallyWords, '71 yes, 22 no');
  assert.deepEqual(v.parties.map((p) => p.text), ['Democrats 11 yes · 21 no', 'Republicans 58 yes · 0 no']);
  assert.equal(v.others, null);
  assert.equal(v.unknown, '3 votes not matched to a party');
  assert.deepEqual(v.links.map((l) => l.label), ['Official record', 'Open States']);
  // Bars are shares of everyone recorded (93), so the two caucuses draw different lengths.
  assert.equal(v.parties[0].bar.yes, 11.8);
  assert.equal(v.parties[1].bar.yes, 62.4);
  assert.equal(v.parties[1].bar.no, 0);
});

test('a party with no votes on the record gets no row; failed votes say Failed', () => {
  const v = voteModel({ ...OH, passed: false, dem_yes: 0, dem_no: 0, dem_other: 0 });
  assert.equal(v.outcome, 'Failed');
  assert.deepEqual(v.parties.map((p) => p.label), ['Republicans']);
  // A party that voted only no still shows, with its zero yes.
  const w = voteModel({ ...OH, dem_yes: 0, dem_no: 9 });
  assert.equal(w.parties[0].text, 'Democrats 0 yes · 9 no');
});

test('unknown party and other parties', () => {
  const allUnknown = voteModel({ ...OH, dem_yes: 0, dem_no: 0, rep_yes: 0, rep_no: 0, party_unknown: 93 });
  assert.deepEqual(allUnknown.parties, []);
  assert.equal(allUnknown.unknown, '93 votes not matched to a party');
  const one = voteModel({ ...OH, party_unknown: 1, oth_yes: 1, oth_no: 0 });
  assert.equal(one.unknown, '1 vote not matched to a party');
  assert.equal(one.others, '+1 other (1 yes · 0 no)');
  const two = voteModel({ ...OH, oth_yes: 1, oth_no: 1, oth_other: 1 });
  assert.equal(two.others, '+3 others (1 yes · 1 no · 1 not voting)');
});

test('missing links', () => {
  const noRecord = voteModel({ ...OH, record_url: null });
  assert.deepEqual(noRecord.links.map((l) => l.label), ['Open States']);
  const unsafe = voteModel({ ...OH, record_url: 'javascript:void(0)' });
  assert.deepEqual(unsafe.links.map((l) => l.label), ['Open States']);
  assert.equal(voteModel({ ...OH, record_url: null, openstates_url: null }), null);
  assert.equal(voteModel({ ...OH, bill_title: '  ' }), null);
  assert.equal(voteModel(null), null);
  assert.equal(votesModel([OH, null, { ...OH, bill_identifier: '' }]).length, 1);
  assert.deepEqual(votesModel(undefined), []);
});

test('chamber names, including Nebraska\'s single chamber', () => {
  assert.equal(chamberLabel({ state: 'NE', chamber: 'legislature', chamber_name: 'Legislature' }), 'Nebraska Legislature');
  assert.equal(chamberLabel({ state: 'NE', chamber: 'legislature', chamber_name: 'Nebraska Legislature' }), 'Nebraska Legislature');
  assert.equal(chamberLabel({ state: 'NE', chamber: 'legislature', chamber_name: '' }), 'Nebraska Legislature');
  assert.equal(chamberLabel({ state: 'CA', chamber: 'lower', chamber_name: 'Assembly' }), 'California Assembly');
  assert.equal(chamberLabel({ state: 'OH', chamber: 'upper', chamber_name: null }), 'Ohio Senate');
  const ne = voteModel({ ...OH, state: 'NE', chamber: 'legislature', chamber_name: 'Legislature' });
  assert.equal(ne.chamber, 'Nebraska Legislature');
});

test('the motion is shown as recorded unless it only repeats the outcome', () => {
  assert.equal(voteModel(OH).motion, 'Concurred in Senate amendments');
  assert.equal(voteModel({ ...OH, motion: 'Passed' }).motion, '');
  assert.equal(voteModel({ ...OH, motion: 'Passed', passed: false }).motion, 'Passed');
});

test('not-voting totals appear in words', () => {
  const v = voteModel({ ...OH, other: 9 });
  assert.equal(v.tallyWords, '71 yes, 22 no, 9 not voting');
});

const TOPIC = {
  id: 't1', title: 'Petrol prices', place: 'US', neutral_fact: 'The average US retail price was $3.10 a gallon.',
  neutral_fact_source: 'https://www.eia.gov/petroleum/gasdiesel/', status: 'published', published_at: '2026-11-12T10:00:00Z',
  statements: [
    { side: 'R', speaker: 'R Speaker', role: 'Senator', quote: 'Quote R.', said_on: '2026-11-10', source_url: 'https://example.gov/r', created_at: '2026-11-11T00:00:00Z' },
    { side: 'other', speaker: 'I Speaker', quote: 'Quote I.', source_url: 'https://example.gov/i', created_at: '2026-11-11T00:00:00Z' },
    { side: 'D', speaker: 'D Speaker', role: 'Representative', quote: 'Quote D.', said_on: '2026-11-09', source_url: 'https://example.gov/d', created_at: '2026-11-11T00:00:01Z' },
  ],
};

test('topics: Democrat, Republican, then others; quotes untouched', () => {
  const t = topicModel(TOPIC);
  assert.equal(t.place, 'National');
  assert.equal(t.date, '12 Nov 2026');
  assert.deepEqual(t.statements.map((s) => s.sideLabel), ['Democrat', 'Republican', 'Independent or other']);
  assert.equal(t.statements[0].quote, 'Quote D.');
  assert.equal(t.statements[0].date, '9 Nov 2026');
  assert.equal(t.statements[1].source.host, 'example.gov');
  assert.equal(t.factSource.host, 'eia.gov');
  assert.equal(topicModel({ ...TOPIC, place: 'OH' }).place, 'Ohio');
});

test('topics need both sides and a safe source to be shown', () => {
  assert.equal(topicsModel([{ ...TOPIC, statements: TOPIC.statements.filter((s) => s.side !== 'R') }]).length, 0);
  assert.equal(topicModel({ ...TOPIC, neutral_fact_source: 'javascript:x' }), null);
  const badQuote = topicModel({ ...TOPIC, statements: [...TOPIC.statements, { side: 'D', speaker: 'X', quote: 'Y', source_url: 'data:x' }] });
  assert.equal(badQuote.statements.length, 3);
  assert.equal(topicsModel([TOPIC, null]).length, 1);
});
