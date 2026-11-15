const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFaa } = require('../server.js');
test('FAA XML parsing keeps delay programmes and drops NOTAM closures', () => {
  const xml = '<AIRPORT_STATUS_INFORMATION><Update_Time>now</Update_Time><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>DAL</ARPT><Reason>!DAL 11/044 DAL AD AP CLSD 2611150229-2611151200</Reason><Start>x</Start><Reopen>Nov 15 at 12:00 UTC.</Reopen></Airport><Airport><ARPT>LAX</ARPT><Reason>!LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT</Reason></Airport></Airport_Closure_List></Delay_type><Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>ORD</ARPT><Reason>snow</Reason><Avg>1 hour and 12 minutes</Avg><Max>3 hours</Max></Ground_Delay></Ground_Delay_List></Delay_type></AIRPORT_STATUS_INFORMATION>';
  const out = parseFaa(xml);
  assert.deepEqual(Object.keys(out.airports), ['ORD']);
  assert.equal(out.airports.ORD[0].type, 'Ground Delay Program');
  assert.match(out.airports.ORD[0].detail, /1 hour and 12 minutes, snow/);
});
