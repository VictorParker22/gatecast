#!/usr/bin/env node
// Gatecast server: serves the static site and proxies the live sources that do not
// send CORS headers (NOAA airport observations, FAA airport status). No dependencies.
//   node server.js            -> http://localhost:4173 (compiles styles/site.css and console.css first if missing or stale)
//   npm run dev               -> the same, with the stylesheet rebuilt on every change (scripts/dev.cjs)
//   PORT=8080 node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 4173;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};
const PUBLIC = ['index.html', 'flights.html', 'trip.html', 'review.html', 'how.html', 'library.html', 'robots.txt', 'styles', 'js', 'data', 'vendor', 'assets'];
// File names carry no content hash, so pages, scripts and styles are always revalidated (a cheap 304):
// a long cache could pair a new weather.js with an old core.js. Only files whose staleness is harmless
// get a short freshness window: the airport list, and the vendored fonts and map library. Same as vercel.json.
const cacheControl = (top) => (top === 'data' ? 'public, max-age=3600, stale-while-revalidate=86400'
  : top === 'vendor' || top === 'assets' ? 'public, max-age=86400, stale-while-revalidate=604800'
    : 'public, max-age=0, must-revalidate');

const { api, parseFaa, FAA_PLANS_CACHE } = require('./lib/live.js');
const news = require('./lib/news.js');
const weird = require('./lib/weird.js');
const books = require('./lib/books.js');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, body, type, extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...extra });
    res.end(body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', 'text/plain');

  if (url.pathname === '/api/news') {
    try { return send(200, JSON.stringify(await news.newsFor(url.searchParams)), TYPES['.json'], { 'Cache-Control': news.CACHE_CONTROL }); }
    catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json']); }
  }
  if (url.pathname === '/api/book-covers') {
    try {
      const only = url.searchParams.get('only');
      if (only !== null) {
        const parsed = books.parseOnly(only);
        if (parsed.error) return send(400, JSON.stringify({ error: parsed.error }), TYPES['.json'], { 'Cache-Control': 'no-store' });
        return send(200, JSON.stringify(await books.coversOnly(parsed.ids)), TYPES['.json'], { 'Cache-Control': 'no-store' });
      }
      const out = await books.coversFor();
      return send(200, JSON.stringify(out), TYPES['.json'], { 'Cache-Control': books.cacheControlFor(out) });
    }
    catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json'], { 'Cache-Control': 'no-store' }); }
  }
  if (url.pathname === '/api/weird') {
    try {
      const body = JSON.stringify(await weird.weirdFor(url.searchParams));
      return send(200, body, TYPES['.json'], { 'Cache-Control': url.searchParams.get('debug') ? weird.DEBUG_CACHE_CONTROL : weird.CACHE_CONTROL });
    } catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json'], { 'Cache-Control': 'no-store' }); }
  }
  // The sitemap is written by the build step; locally it is made on request, dated today, from the same code.
  if (url.pathname === '/sitemap.xml') return send(200, require('./scripts/build-data.cjs').sitemapXml(), TYPES['.xml'], { 'Cache-Control': 'public, max-age=0, must-revalidate' });
  if (url.pathname === '/api/faa-plans') {
    try { return send(200, JSON.stringify(await api[url.pathname](url.searchParams)), TYPES['.json'], { 'Cache-Control': FAA_PLANS_CACHE }); }
    catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json'], { 'Cache-Control': 'no-store' }); }
  }
  if (api[url.pathname]) {
    try { return send(200, JSON.stringify(await api[url.pathname](url.searchParams)), TYPES['.json']); }
    catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json']); }
  }

  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  const top = rel.split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.includes(top)) return send(404, 'Not found', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(404, 'Not found', 'text/plain');
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = { 'Cache-Control': cacheControl(top), ETag: etag, 'Last-Modified': st.mtime.toUTCString() };
    if (req.headers['if-none-match'] === etag) return send(304, undefined, type, headers);
    fs.readFile(file, (err2, data) => {
      if (err2) return send(404, 'Not found', 'text/plain');
      send(200, data, type, headers);
    });
  });
});

if (require.main === module) {
  // The pages link styles/site.css, compiled from styles/main.css by Tailwind. Build it once if it is missing or older
  // than its sources (npm run dev keeps it fresh instead); a missing Tailwind install is reported, not fatal.
  if (!process.env.GATECAST_NO_CSS) {
    try { const css = require('./scripts/build-css.cjs'); if (css.stale()) { css.buildCss(); console.log('compiled styles/site.css and styles/console.css'); } }
    catch (err) { console.warn('styles/site.css not built: ' + err.message.split('\n')[0]); }
  }
  server.listen(PORT, () => console.log(`Gatecast running at http://localhost:${PORT}`));
}
module.exports = { parseFaa, server };
