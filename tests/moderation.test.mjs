import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { moderate, RULES, pathWords, mentionsChild } = require('../lib/moderation.js');

// Headlines below are test cases written for these rules, not real stories (except where a pick is quoted).
const verdict = (title, extra = {}) => moderate({ title, ...extra });
const rule = (title, extra) => { const v = verdict(title, extra); return v.ok ? 'ok' : `${v.rule}:${v.action}`; };

test('the situation is strange: these pass', () => {
  for (const t of [
    'Moose caught on camera sliding down icy Alaska driveway',
    'Viral video shows two horses boarding Detroit city bus',
    "'Just a phase': Wild turkey with unusual colors caught on camera",
    "Escaped piglets detained for 'fleeing and squealing' in S.C.",
    "British town crier is the world's loudest woman",
    'Hundreds gather to attempt to \'move The Bean\' in Chicago',
    'Calif. coast battered by monster waves as El Nino strengthens grip',
    'Town bans lawn flamingos',
    'Waterspout caught on camera off Florida coast',
    'Blind taste test crowns best pizza in Naples',
    'Dwarf planet found to have a tiny moon',
    '15-year-old cat named oldest in Ohio',
    'Baby goats invade yoga class',
    'Watch: Bear raids kitchen cabinets in Tennessee cabin',
    'Lost wedding ring found inside potato after 16 years',
  ]) assert.equal(rule(t), 'ok', t);
});

test('a person\'s misfortune is not the joke: each hold rule', () => {
  const cases = {
    H1: ['Dog found dead in hot car', 'Mummified cat found in wall', 'Fisherman drowns chasing record catch', 'Mystery remains unsolved'],
    H2: ['Hospital patient finds worm in eye', 'Doctors find tapeworm living in man\'s brain', 'Shark attack closes beach', 'Man taken to ER after hot-dog contest'],
    H3: ['Runaway parakeet rescued from storm drain', 'Starving horses seized from farm', 'Goats abandoned on highway shoulder'],
    H4: ['Crazy man climbs tower', 'Welfare check finds hoarder\'s house full of clocks'],
    H5: ['Sheep on the lam for 45 days roped by 13-year-old cowgirl', 'Toddler crowned champion of pie contest', 'School goes viral for cafeteria dance'],
    H6: ['Homeless man builds castle from cans', 'Hilarious pensioner tries to use smartphone'],
    H7: ['Woman, 34, from Leeds slammed for parking', 'Viral video shows woman dancing with goat', 'TikToker films neighbour\'s fence', 'Karen meltdown at drive-thru'],
    H8: ['Man arrested after naked run through zoo', 'Florida man accused of stealing alligator', 'Burglar falls asleep in bathtub'],
    H10: ['Plane crash survivor tells odd tale', 'Hikers stranded on mountain by fog', 'Flood sweeps cars into river'],
    H11: ['Village holds exorcism for haunted bridge', 'Museum shows witch bottles found in old walls'],
  };
  for (const [want, titles] of Object.entries(cases)) {
    for (const t of titles) {
      const v = verdict(t);
      assert.equal(v.ok, false, t);
      assert.equal(v.action, 'hold', t);
      assert.equal(v.rule, want, t);
    }
  }
});

test('drops: sexual content and a child with a crime are never queued', () => {
  assert.equal(rule('Sex toy found on beach'), 'H9:drop');
  assert.equal(rule('Nude sunbathers interrupt village fete'), 'H9:drop');
  assert.equal(rule('Train pervert caught on camera'), 'H9:drop');
  assert.equal(rule('Teen charged with stealing goat from petting zoo'), 'H5:drop');
  assert.equal(rule('Boy, 12, arrested for driving dad\'s car'), 'H5:drop');
  // Drops apply even when holds are switched off (a pick the owner reviewed).
  assert.equal(moderate({ title: 'Teen charged with stealing goat' }, { holds: false }).action, 'drop');
  assert.equal(moderate({ title: 'Runaway parakeet rescued from storm drain' }, { holds: false }).ok, true);
});

test('the URL path and feed categories are read too, never anything else', () => {
  assert.equal(rule('Strange find in the attic', { url: 'https://www.example.com/news/human-remains-attic/1/' }), 'H1:hold');
  assert.equal(rule('Strange find in the attic', { url: 'https://www.example.com/news/old-letters-attic/1/' }), 'ok');
  assert.equal(rule('Strange find in the attic', { categories: ['Crime'] }), 'ok'); // a label alone is not a crime word
  assert.equal(rule('Strange find in the attic', { categories: ['Court cases'] }), 'H8:hold');
  assert.equal(pathWords('https://www.upi.com/Odd_News/2026/11/13/sheep-wadsworth-ohio-lassoed/6691794592131/'), 'Odd News 2026 11 13 sheep wadsworth ohio lassoed 6691794592131');
  assert.equal(pathWords('not a url'), '');
});

test('idioms do not trip the rules; children are told from young animals', () => {
  assert.equal(rule('Dead heat in the annual snail race'), 'ok');
  assert.equal(rule('Fish change sex when the water warms'), 'ok');
  assert.equal(rule('Clinical trials of a hiccup cure'), 'ok');
  assert.ok(mentionsChild('Toddler wins race'));
  assert.ok(mentionsChild('A 9-year-old builds a robot'));
  assert.ok(mentionsChild('Baby found in basket'));
  assert.ok(!mentionsChild('Baby elephant learns to swim'));
  assert.ok(!mentionsChild('10-year-old dog wins agility contest'));
  assert.ok(!mentionsChild('101-year-old woman skydives'));
  assert.ok(!mentionsChild('Cowboy ropes runaway bull'));
});

test('an empty or missing headline is never shown; every rule has a name', () => {
  assert.deepEqual(moderate({ title: '' }), { ok: false, rule: 'H0', action: 'drop' });
  assert.deepEqual(moderate(null), { ok: false, rule: 'H0', action: 'drop' });
  assert.deepEqual(Object.keys(RULES), ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11']);
});
