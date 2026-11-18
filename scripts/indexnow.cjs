#!/usr/bin/env node
// Tells the search engines that take part in IndexNow (Bing, Yandex, Seznam, Naver and others; not Google) that
// Gatecast's pages have changed, so they recrawl them sooner. Run it by hand after a deploy that changed pages:
//   node scripts/indexnow.cjs                 every URL in the sitemap
//   node scripts/indexnow.cjs --dry-run       print what would be sent, send nothing
//   node scripts/indexnow.cjs https://www.thegatecast.com/how.html ...   only these URLs
// The key is the 32-character file at the repo root (<key>.txt, holding the key itself), which the build copies to
// https://www.thegatecast.com/<key>.txt. It is public by design: IndexNow checks that file to confirm the URLs are
// ours. Before sending, the script checks that the deployed key file is there and matches (skip with --no-check).
// The URL list comes from public/sitemap.xml when the site has been built, otherwise from the same code that
// writes it (scripts/build-data.cjs sitemapXml).
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS = 10000; // IndexNow's limit for one request

// What each answer from IndexNow means (https://www.indexnow.org/documentation).
const ANSWERS = {
  200: 'OK: the URLs were received.',
  202: 'Accepted: the URLs were received; the key is still being checked.',
  400: 'Bad request: the request was not valid.',
  403: 'Forbidden: the key was not valid (is the key file deployed at the address above?).',
  422: 'Unprocessable: a URL is not on this host, or the key does not match the file.',
  429: 'Too many requests: wait a while before submitting again.',
};

function readKey(dir = root) {
  const files = fs.readdirSync(dir).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  if (files.length !== 1) throw new Error(`expected one IndexNow key file (<32 hex>.txt) at the repo root, found ${files.length}`);
  const key = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim();
  if (key + '.txt' !== files[0]) throw new Error(`${files[0]} must hold its own name without .txt`);
  return key;
}

const urlsFromSitemap = (xml) => [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

function sitemapUrls(dir = root) {
  const built = path.join(dir, 'public', 'sitemap.xml');
  const xml = fs.existsSync(built) ? fs.readFileSync(built, 'utf8') : require('./build-data.cjs').sitemapXml();
  return urlsFromSitemap(xml);
}

// The request bodies for a list of URLs on one site: only that site's https URLs, no repeats, at most MAX_URLS each.
function payloads(urls, { site, key }) {
  const origin = new URL(site).origin, host = new URL(site).host;
  const list = [...new Set(urls)];
  const bad = list.filter((u) => { try { return new URL(u).origin !== origin; } catch { return true; } });
  if (bad.length) throw new Error('not on ' + origin + ': ' + bad.join(', '));
  if (!list.length) throw new Error('no URLs to submit');
  const out = [];
  for (let i = 0; i < list.length; i += MAX_URLS) {
    out.push({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: list.slice(i, i + MAX_URLS) });
  }
  return out;
}

// Is the key file live and right? IndexNow fetches it to check the key, so a missing file means a 403.
async function checkKeyFile({ site, key, fetchImpl = fetch }) {
  const url = `${new URL(site).origin}/${key}.txt`;
  let res;
  try { res = await fetchImpl(url, { redirect: 'follow' }); } catch (err) { return { ok: false, url, why: 'could not be fetched: ' + err.message }; }
  if (!res.ok) return { ok: false, url, why: `answered ${res.status}` };
  const body = (await res.text()).trim();
  return body === key ? { ok: true, url } : { ok: false, url, why: 'does not hold the key' };
}

async function submit(urls, { site, key, fetchImpl = fetch, log = console.log, dryRun = false, check = true } = {}) {
  const bodies = payloads(urls, { site, key });
  if (dryRun) {
    for (const b of bodies) log(`would POST ${b.urlList.length} URLs to ${ENDPOINT}:\n` + JSON.stringify(b, null, 2));
    return { sent: 0, results: [] };
  }
  if (check) {
    const k = await checkKeyFile({ site, key, fetchImpl });
    if (!k.ok) throw new Error(`the key file ${k.url} ${k.why}; deploy first, or pass --no-check`);
  }
  const results = [];
  for (const b of bodies) {
    const res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(b) });
    const note = ANSWERS[res.status] || `Unexpected answer ${res.status}.`;
    log(`${b.urlList.length} URLs: ${res.status} ${note}`);
    results.push({ status: res.status, count: b.urlList.length, ok: res.status === 200 || res.status === 202 });
  }
  return { sent: results.filter((r) => r.ok).reduce((n, r) => n + r.count, 0), results };
}

async function main(argv = process.argv.slice(2)) {
  const { SITE } = require('./build-data.cjs');
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const unknown = [...flags].filter((f) => !['--dry-run', '--no-check'].includes(f));
  if (unknown.length) throw new Error('unknown option ' + unknown.join(', '));
  const given = argv.filter((a) => !a.startsWith('--'));
  const urls = given.length ? given : sitemapUrls();
  const out = await submit(urls, { site: SITE, key: readKey(), dryRun: flags.has('--dry-run'), check: !flags.has('--no-check') });
  if (out.results.some((r) => !r.ok)) process.exitCode = 1;
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
module.exports = { readKey, urlsFromSitemap, sitemapUrls, payloads, checkKeyFile, submit, main, ENDPOINT, MAX_URLS };
