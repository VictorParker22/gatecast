// Moderation rules for the weird-news front page (/api/weird). Pure functions, no I/O.
// Adapted from docs/moderation-policy.md for headline-and-link weird news (summary in docs/content-sources.md,
// "Weird news"; rule numbers H1-H11 follow the scout's moderation notes). The test: is the strangeness in the situation, or in a person's misfortune?
// Only the first runs.
//
// What is read: the outlet's headline, the words of the story's URL path and the feed's own category labels.
// Never the description or article text (lib/news.js never reads them).
//
// Two outcomes besides ok: "drop" (never shown, never queued: sexual content, a child with a crime) and "hold"
// (would need a person's approval). There is no review queue yet, so a held item is not shown either; the
// difference is kept so a queue can be added later and so ?debug=1 can count each rule. Automated rules only
// remove, never publish: when in doubt they hold. Editor's picks that the owner has reviewed (seeded: false)
// skip the hold rules, because a person has decided; they still go through the drop rules.

const words = (list) => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');

/* ---------- Word lists ---------- */

// Animals, shared with lib/weird.js for the "Strange Animals" category.
const ANIMAL_LIST = [
  'animals?', 'pets?', 'wildlife', 'creatures?', 'zoo', 'aquarium', 'livestock',
  'dogs?', 'pupp(?:y|ies)', 'pups?', 'cats?', 'kittens?', 'horses?', 'ponies', 'pony', 'cows?', 'cattle', 'bulls?', 'calf', 'calves',
  'pigs?', 'piglets?', 'hogs?', 'boars?', 'goats?', 'sheep', 'lambs?', 'llamas?', 'alpacas?', 'camels?', 'donkeys?', 'mules?',
  'chickens?', 'hens?', 'roosters?', 'ducks?', 'ducklings?', 'geese', 'goose', 'swans?', 'turkeys?', 'emus?', 'ostrich(?:es)?',
  'peacocks?', 'parrots?', 'parakeets?', 'budgies?', 'owls?', 'eagles?', 'hawks?', 'falcons?', 'pigeons?', 'crows?', 'ravens?',
  'seagulls?', 'gulls?', 'penguins?', 'flamingos?', 'pelicans?', 'birds?', 'snakes?', 'pythons?', 'cobras?', 'lizards?', 'iguanas?',
  'geckos?', 'tortoises?', 'turtles?', 'frogs?', 'toads?', 'salamanders?', 'crocodiles?', 'alligators?', 'gators?', 'bears?', 'cubs?',
  'deer', 'fawns?', 'moose', 'elk', 'reindeer', 'caribou', 'fox', 'foxes', 'wolf', 'wolves', 'coyotes?', 'raccoons?', 'skunks?',
  'squirrels?', 'chipmunks?', 'rabbits?', 'bunn(?:y|ies)', 'hares?', 'mouse', 'mice', 'rats?', 'hamsters?', 'beavers?', 'otters?',
  'badgers?', 'hedgehogs?', 'porcupines?', 'bats?', 'monkeys?', 'apes?', 'gorillas?', 'chimps?', 'chimpanzees?', 'orangutans?',
  'baboons?', 'lemurs?', 'sloths?', 'kangaroos?', 'wallab(?:y|ies)', 'koalas?', 'wombats?', 'o?possums?', 'elephants?', 'giraffes?',
  'zebras?', 'hippos?', 'rhinos?', 'lions?', 'tigers?', 'leopards?', 'cheetahs?', 'jaguars?', 'cougars?', 'panthers?', 'lynx',
  'bobcats?', 'hyenas?', 'pandas?', 'whales?', 'dolphins?', 'porpoises?', 'seals?', 'sea lions?', 'walrus(?:es)?', 'sharks?',
  'fish', 'octopus(?:es)?', 'octopi', 'squids?', 'jellyfish', 'crabs?', 'lobsters?', 'shrimp', 'eels?', 'stingrays?', 'starfish',
  'snails?', 'slugs?', 'worms?', 'spiders?', 'tarantulas?', 'scorpions?', 'insects?', 'bees?', 'wasps?', 'hornets?', 'ants?',
  'butterfl(?:y|ies)', 'moths?', 'beetles?', 'cockroach(?:es)?', 'locusts?', 'grasshoppers?', 'mosquito(?:e?s)?', 'dinosaurs?',
];
const ANIMAL = words(ANIMAL_LIST);

// Sky and nature: the subject of a "caught on camera" clip that is not a person.
const NATURE = words(['tornado(?:e?s)?', 'waterspouts?', 'lightning', 'meteors?', 'fireballs?', 'auroras?', 'northern lights', 'waves?',
  'storms?', 'clouds?', 'icebergs?', 'volcano(?:e?s)?', 'eruptions?', 'hail', 'snow\\w*', 'rainbows?', 'eclipse', 'comets?', 'geysers?']);

// People: used to tell a clip of a person from a clip of an animal, and for slurs aimed at a person.
const PERSON = words(['man', 'men', 'woman', 'women', 'person', 'people', 'guy', 'guys', 'lady', 'ladies', 'drivers?', 'passengers?',
  'mom', 'mum', 'mother', 'dad', 'father', 'husband', 'wife', 'bride', 'groom', 'couple', 'neighbou?rs?', 'customers?', 'shoppers?',
  'tourists?', 'residents?', 'workers?', 'employees?', 'students?', 'boyfriend', 'girlfriend', 'grandma', 'grandpa', 'grandmother',
  'grandfather', 'teens?', 'teenagers?', 'kids?', 'child', 'children', 'boy', 'girl', 'owner', 'homeowner', 'diners?', 'fans?',
  'he', 'she', 'his', 'her', 'him', 'neighbourhood', 'neighborhood']);

// Phrases that contain a listed word without its meaning. Removed before any rule is tried.
const IDIOMS = /\b(?:dead heat|drop[- ]dead|dead ringer|dead sea|day of the dead|grateful dead|body of water|bodies of water|governing body|dwarf (?:planet|planets|star|stars|galaxy|galaxies)|(?:white|brown|red) dwarfs?|blind (?:taste|tasting|date|spot)|clinical trials?|trial run|courtyards?|shot put|long shot|moonshot|shot glass(?:es)?|(?:change|changes|changing|changed) sex|sex[- ]chang\w*|sex ratios?|sex determination|witching hour)\b/gi;

/* ---------- Rules ---------- */

const H1 = words(['dies', 'died', 'dying', 'dead', 'deaths?', 'deadly', 'fatal\\w*', 'killed', 'kills?', 'killing', 'killers?', 'bod(?:y|ies)',
  'corpses?', 'remains', 'funerals?', 'coroners?', 'autops(?:y|ies)', 'drown\\w*', 'murder\\w*', 'homicides?', 'suicid\\w*', 'obituar\\w*',
  'mumm(?:y|ies|ified)', 'skeletons?', 'skeletal', 'skulls?', 'burials?']);

const H2 = words(['injur\\w*', 'hospital\\w*', 'surger(?:y|ies)', 'surgeons?', 'surgical\\w*', 'amputat\\w*', 'bitten', 'bites', 'bit by',
  'mauled', 'mauling', 'attack\\w*', 'stabb\\w*', 'stabs?', 'shot', 'shoots?', 'shooting', 'gunshots?', 'burns', 'burned', 'burnt', 'impaled',
  'tumou?rs?', 'tapeworms?', 'swallowed', 'lodged in', 'rare (?:condition|disease|disorder|syndrome)s?', 'disfigur\\w*', 'wounds?', 'wounded',
  'bleed\\w*', 'broken (?:bones?|legs?|arms?|necks?|backs?)', 'paramedics?', 'ambulances?', 'struck by', 'electrocut\\w*',
  // Health and medicine: outbreaks, diseases and treatments are never the joke. A virus or a brain in a science story
  // (an ancient virus in human DNA) is not on this list; an outbreak, an infection or a cure is.
  'outbreaks?', 'epidemics?', 'pandemics?', 'dengue', 'cancer\\w*', 'diseases?', 'hpv', 'infections?', 'infected', 'infectious',
  'contagious', 'chemotherapy', 'vaccin\\w*', 'patients?', 'diagnos\\w*', 'symptoms?', 'measles', 'malaria', 'cholera', 'ebola',
  'covid\\w*', 'flu', 'influenza', 'medical', 'medicines?', 'treatments?', 'therap(?:y|ies)', 'cures?', 'clinic\\w*', 'overdos\\w*',
  'pharmac\\w*', 'prescri\\w*', 'doctors?', 'nurses?']);
const ER = /\bER\b/; // the emergency room, written in capitals
const PARASITE = words(['parasites?', 'parasitic', 'worms?', 'maggots?', 'larva[e]?']);
const BODY_PART = words(['brain', 'eyes?', 'stomach', 'gut', 'intestin\\w*', 'skin', 'lungs?', 'liver', 'ears?', 'nose', 'head', 'throat']);

const H3 = words(['cruelty', 'cruel', 'abus\\w*', 'neglect\\w*', 'starv\\w*', 'tortur\\w*', 'poison\\w*', 'put down', 'euthani[sz]\\w*',
  'cull(?:s|ed|ing)?', 'roadkill', 'found dead', 'hoarding', 'rescued from']);
const ANIMAL_HARM = words(['shot', 'beaten', 'kicked', 'dragged', 'thrown', 'trapped', 'stuck', 'abandoned', 'dumped']);

const H4 = words(['mental(?:ly)? ill\\w*', 'mental health', 'psychiatric', 'schizophren\\w*', 'psychos[ie]s', 'psychotic', 'bipolar',
  'delusion\\w*', 'hoard\\w*', 'breakdown', 'sectioned', 'asylum', 'welfare checks?', 'in crisis', 'erratic']);
const SLUR = words(['crazy', 'insane', 'lunatics?', 'psychos?', 'nutcases?', 'nutters?', 'madm[ae]n', 'madwom[ae]n', 'maniacs?', 'loon(?:y|ies|s)?',
  'weirdos?', 'freaks?']);

const CHILD = words(['child', 'children', 'kids?', 'toddlers?', 'infants?', 'newborns?', 'boys?', 'girls?', 'teens?', 'teenage(?:rs?|d)?',
  'schoolboys?', 'schoolgirls?', 'minors', 'a minor', 'daycare', 'preschool\\w*', 'kindergarten\\w*', 'pupils?']);
const BABY = /\bbab(?:y|ies)\b(?:\s+(\w+))?/gi;
const AGE = /\b(\d{1,2})[- ]?(?:year|yr)s?[- ]old\b(?:\s+(\w+))?(?:\s+(\w+))?/gi;
const SCHOOL = words(['schools?', 'classrooms?']);

const H6_DIRECT = words(['wheelchairs?', 'amputees?', 'blind', 'deaf', 'autis\\w*', 'dwarf(?:s|ism)?', 'disab\\w*', 'paraly\\w*', 'homeless\\w*',
  'beggars?', 'begging', 'evict\\w*', 'squatters?', 'poverty', 'slums?', 'welfare', 'on benefits', 'benefits? (?:claimants?|cheats?|fraud)']);
const H6_BODY = words(['obese', 'obesity', 'morbidly', 'fat', 'ugliest', 'ugly', 'pensioners?', 'grann(?:y|ies)', 'elderly', 'oaps?',
  'old (?:man|woman|lady|men|women)']);
const MOCKING = words(['bizarre', 'weird', 'hilarious', 'funny', "you won'?t believe", 'laugh\\w*', 'mock\\w*', 'ridicul\\w*', 'freak\\w*']);

const H7_SUBJECT = words(['viral', 'tik ?toks?', 'tiktokers?', 'reddit\\w*', 'video shows', 'videos? show', 'caught on (?:camera|video|cam|film|tape)',
  'filmed', 'cctv', 'doorbell (?:cam|camera)s?', 'dash ?cams?', 'footage', 'netizens', 'internet reacts', 'social media users',
  'influencers?', 'youtubers?', 'instagram\\w*']);
const H7_ALWAYS = words(['slammed', 'trolled', 'called out', 'karens?', 'shamed', 'goes viral for']);
const NAMED_AGE = /\b[A-Z][a-z]+,\s*\d{1,3},\s*(?:from|of)\b/; // "Smith, 34, from Leeds": a named private person (case-sensitive)

const H8 = words(['arrest\\w*', 'charged', 'charges', 'accused', 'suspects?', 'suspected', 'police say', 'courts?', 'jail\\w*', 'prison\\w*',
  'sentenced', 'guilty', 'trials?', 'stole', 'stolen', 'steal\\w*', 'theft', 'thie(?:f|ves)', 'burglar\\w*', 'robber\\w*', 'robbed', 'drunk\\w*',
  'dui', 'dwi', 'florida man', 'naked', 'fraud\\w*', 'smuggl\\w*', 'kidnap\\w*', 'assault\\w*', 'shoplift\\w*', 'vandal\\w*', 'convicted',
  'indicted', 'mugshots?']);

const H9 = words(['sex', 'sexual\\w*', 'sexy', 'sexting', 'nudes?', 'nudity', 'nudist\\w*', 'naked (?:photos?|pictures?|pics|images?|selfies?)',
  'porn\\w*', 'pervert\\w*', 'pervs?', 'grop(?:e|ed|es|ing)', 'upskirt\\w*', 'molest\\w*', 'prostitut\\w*', 'fetish\\w*', 'brothels?',
  'strip ?clubs?', 'strippers?', 'onlyfans', 'erotic\\w*', 'voyeur\\w*', 'indecen\\w*', 'lewd\\w*', 'rape', 'raped', 'rapists?', 'x-rated',
  'adult films?', 'sex toys?']);

const H10 = words(['crash\\w*', 'collaps\\w*', 'explosions?', 'explod\\w*', 'wildfires?', 'missing', 'stranded', 'rescu\\w*', 'earthquakes?',
  'quakes?', 'floods?', 'flooding', 'flooded', 'tsunamis?', 'avalanches?', 'landslides?', 'mudslides?', 'war', 'refugees?', 'trapped',
  'sinking', 'sank', 'capsiz\\w*', 'derail\\w*', 'evacuat\\w*', 'wreckage', 'hostages?']);
const FIRE = words(['fires?', 'blaze', 'ablaze', 'on fire']);

const H11 = words(['witch\\w*', 'exorcis\\w*', 'sorcer\\w*', 'black magic', 'voodoo', 'occult', 'sacrific\\w*', 'satanic']);
const CURSED = words(['cursed', 'curses?']);

const RULES = {
  H1: 'Deaths',
  H2: 'Injuries and medical harm',
  H3: 'Animal cruelty or animal deaths',
  H4: 'Mental illness',
  H5: 'Children',
  H6: 'Mocking disabled, poor, fat or old people',
  H7: 'Private individuals going viral',
  H8: 'Crime, arrests and court',
  H9: 'Sexual content',
  H10: 'Disaster and tragedy with an odd hook',
  H11: 'Superstition, witchcraft and religion targeting people',
};

/* ---------- Text ---------- */

// The words of a story's address: "/Odd_News/2026/11/13/sheep-wadsworth-ohio-lassoed/669/" -> "Odd News 2026 11 13 sheep wadsworth ohio lassoed 669".
function pathWords(url) {
  try {
    const p = decodeURIComponent(new URL(url).pathname);
    return p.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[/_+.-]+/g, ' ').trim();
  } catch { return ''; }
}

// Everything the rules may read, one string per source of text, typography normalised and idioms removed.
function textOf(item) {
  const parts = [item && item.title, item && item.url ? pathWords(item.url) : '', ...(Array.isArray(item && item.categories) ? item.categories : [])];
  return parts.filter((x) => typeof x === 'string' && x).join(' \n ')
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-')
    .replace(IDIOMS, ' ');
}

// A child is named: a child word, a "baby" that is not a baby animal, or an age under 18 that is not an animal's.
function mentionsChild(text) {
  if (CHILD.test(text)) return true;
  for (const m of text.matchAll(BABY)) if (!(m[1] && ANIMAL.test(m[1]))) return true;
  for (const m of text.matchAll(AGE)) {
    if (Number(m[1]) >= 18) continue;
    const next = [m[2], m[3]].filter(Boolean).join(' ');
    if (!(next && ANIMAL.test(next))) return true;
  }
  return false;
}

/* ---------- The decision ---------- */

// item: { title, url?, categories? }. Returns { ok: true } or { ok: false, rule: 'H1'..'H11', action: 'drop' | 'hold' }.
// holds: false skips the hold rules (for a pick a person has reviewed); the drop rules always apply.
function moderate(item, { holds = true } = {}) {
  const t = textOf(item);
  const title = String((item && item.title) || '');
  if (!t.trim()) return { ok: false, rule: 'H0', action: 'drop' }; // nothing to judge: never shown
  const child = mentionsChild(t);
  const crime = H8.test(t);

  // Drops: never shown and never queued.
  if (H9.test(t)) return { ok: false, rule: 'H9', action: 'drop' };
  if (child && crime) return { ok: false, rule: 'H5', action: 'drop' };
  if (!holds) return { ok: true };

  const hold = (rule) => ({ ok: false, rule, action: 'hold' });
  const animal = ANIMAL.test(t);
  const person = PERSON.test(t);
  if (H1.test(t)) return hold('H1');
  if (H2.test(t) || ER.test(title) || (PARASITE.test(t) && BODY_PART.test(t))) return hold('H2');
  if (H3.test(t) || (animal && ANIMAL_HARM.test(t))) return hold('H3');
  if (H4.test(t) || (SLUR.test(t) && person)) return hold('H4');
  if (child) return hold('H5');
  if (SCHOOL.test(t) && (H1.test(t) || H2.test(t) || H7_SUBJECT.test(t))) return hold('H5');
  if (H6_DIRECT.test(t) || (H6_BODY.test(t) && MOCKING.test(t))) return hold('H6');
  // A clip goes viral: held when it is about a person. An animal or the sky on camera, with no person named, passes.
  if (H7_ALWAYS.test(t) || NAMED_AGE.test(title)) return hold('H7');
  if (H7_SUBJECT.test(t) && !((animal || NATURE.test(t)) && !person)) return hold('H7');
  if (crime) return hold('H8');
  if (H10.test(t) || (FIRE.test(t) && person)) return hold('H10');
  if (H11.test(t) || (CURSED.test(t) && person)) return hold('H11');
  return { ok: true };
}

module.exports = { moderate, RULES, ANIMAL, ANIMAL_LIST, PERSON, pathWords, textOf, mentionsChild };
