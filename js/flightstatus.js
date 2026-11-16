// Plain-language pieces of the flights page that do not touch the DOM, so they can be tested:
// which flight number leads, how fresh the live position is, and the one-line verdict for the airports.

// "BA 0117" -> "BA117": no spaces, no leading zeros in the number.
export function normFlight(s) {
  const m = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])0*(\d{1,4}[A-Z]?)$/);
  return m ? m[1] + m[2] : String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// The number the visitor searched leads; the airline's own number (or the radio callsign) follows quietly.
// q: what they typed; f: { flight: "QY 6741", callsign: "BCS6741" } from /api/flight.
export function flightNames(q, f) {
  const typed = normFlight(q);
  const airline = f && f.flight ? f.flight : '';
  const callsign = f && f.callsign ? f.callsign : '';
  if (airline && normFlight(airline) !== typed) return { primary: typed, alias: `Shown by the airline as ${airline}` };
  if (callsign && normFlight(callsign) !== typed) return { primary: typed, alias: `Radio callsign ${callsign}` };
  return { primary: typed, alias: null };
}

// How old the live position is, in words. ageS: seconds since the aircraft last reported its position.
// Fresh: just "Live". Older: "Live" plus when it last updated. Ten minutes or more: no longer live.
export function freshness(ageS) {
  if (ageS == null || !Number.isFinite(ageS)) return { live: true, stale: false, text: '' };
  const a = Math.max(0, ageS);
  if (a < 45) return { live: true, stale: false, text: '' };
  const min = Math.round(a / 60);
  const ago = a < 90 ? 'just now' : `${min} min ago`;
  if (a < 600) return { live: true, stale: true, text: `updated ${ago}` };
  return { live: false, stale: true, text: `last position ${min} min ago` };
}

// One line for the weather at the airports of a flight (or one airport).
// ends: [{ code, city, level: 'low'|'elevated'|'high'|'unknown', when: 'now'|'landing' }], in travel order.
// Returns { kind: 'calm'|'risk'|'unknown', title, order } where order lists the ends worst first.
const RANK = { high: 3, elevated: 2, low: 1, unknown: 0 };
export function endsVerdict(ends) {
  const known = ends.filter((e) => e.level !== 'unknown');
  const order = [...ends].sort((a, b) => RANK[b.level] - RANK[a.level]);
  if (!known.length) {
    return { kind: 'unknown', title: ends.length > 1 ? 'No forecast for either end right now' : `No forecast for ${ends[0]?.code || 'this airport'} right now`, order };
  }
  const worst = order[0];
  if (worst.level === 'low') {
    const title = ends.length > 1
      ? (known.length === ends.length ? 'Both ends look calm' : `${known[0].code} looks calm; no forecast for ${ends.find((e) => e.level === 'unknown').code}`)
      : `${worst.code} looks calm${worst.when === 'next3h' ? ' for the next 3 hours' : ''}`;
    return { kind: 'calm', title, order };
  }
  const word = worst.level === 'high' ? 'High' : 'Elevated';
  const when = worst.when === 'landing' ? ' around landing' : worst.when === 'departure' ? ' around departure' : worst.when === 'next3h' ? ' in the next 3 hours' : ' right now';
  const both = ends.length > 1 && ends.every((e) => e.level === worst.level);
  return { kind: 'risk', title: both ? `${word} weather risk at both ends` : `${word} weather risk at ${worst.code}${when}`, order };
}
