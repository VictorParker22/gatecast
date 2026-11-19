#!/usr/bin/env node
// Gatecast server: serves the static site and proxies the live sources that do not
// send CORS headers (NOAA airport observations, FAA airport status). No dependencies.
//   node server.js            -> http://localhost:4173 (compiles styles/site.css and the page bundles first if missing or stale)
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
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
};
// The pages and root files (the same list the build copies, scripts/build-data.cjs STATIC_FILES, plus the IndexNow key
// file) and the folders served from the repo.
const site = require('./scripts/build-data.cjs');
const { CLEAN_PAGES } = require('./lib/site.js');
const KEY_FILE = site.indexNowKeyFile();
const PUBLIC = [...site.STATIC_FILES, ...(KEY_FILE ? [KEY_FILE] : []), 'styles', 'js', 'data', 'vendor', 'assets'];
// File names carry no content hash, so pages, scripts and styles are always revalidated (a cheap 304):
// a long cache could pair a new weather.js with an old core.js. Only files whose staleness is harmless
// get a short freshness window: the airport list, and the vendored fonts and map library. Same as vercel.json.
const cacheControl = (top) => (top === 'data' ? 'public, max-age=3600, stale-while-revalidate=86400'
  : top === 'vendor' || top === 'assets' ? 'public, max-age=86400, stale-while-revalidate=604800'
    : 'public, max-age=0, must-revalidate');

const { api, parseFaa, FAA_PLANS_CACHE } = require('./lib/live.js');
const news = require('./lib/news.js');
const weird = require('./lib/weird.js');
const weekly = require('./lib/weekly.js');
const books = require('./lib/books.js');
const stacks = require('./lib/stacks-db.js');
const youtube = require('./lib/youtube.js');
const videos = require('./lib/videos.js');

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
  if (url.pathname === '/api/books') {
    try {
      const out = await stacks.booksFor();
      return send(200, JSON.stringify(out.body), TYPES['.json'], { 'Cache-Control': out.cacheControl });
    } catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json'], { 'Cache-Control': 'no-store' }); }
  }
  // The weekly pages and the feed: rendered on request by lib/weekly.js, as the /api/weird function does on Vercel
  // (vercel.json rewrites /weekly/, /weekly/<YYYY>-W<ww>/ and /feed.xml to /api/weird?view=...).
  if (weekly.needsSlash(url.pathname)) return send(308, '', 'text/plain', { Location: url.pathname + '/' + url.search });
  const wq = url.pathname === '/api/weird' && weekly.isView(url.searchParams.get('view')) ? url.searchParams : weekly.routeQuery(url.pathname);
  if (wq) {
    try {
      const out = await weekly.render(wq);
      return send(out.status, req.method === 'HEAD' ? undefined : out.body, out.type, { 'Cache-Control': out.cacheControl });
    } catch (err) { return send(502, 'The picks could not be loaded just now.\n', 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' }); }
  }
  // Vercel Web Analytics' script exists only on Vercel (js/analytics.js); locally an empty script stands in for it.
  if (url.pathname === '/_vercel/insights/script.js') return send(200, '// Vercel Web Analytics runs only on Vercel.\n', TYPES['.js'], { 'Cache-Control': 'no-store' });
  if (url.pathname === '/api/weird') {
    try {
      const body = JSON.stringify(await weird.weirdFor(url.searchParams));
      return send(200, body, TYPES['.json'], { 'Cache-Control': url.searchParams.get('debug') ? weird.DEBUG_CACHE_CONTROL : weird.CACHE_CONTROL });
    } catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json'], { 'Cache-Control': 'no-store' }); }
  }
  // A YouTube video's still image, fetched by the server so the visitor's browser contacts only Gatecast (api/yt-thumb.js).
  if (url.pathname === '/api/yt-thumb') {
    const out = await youtube.thumbFor(url.searchParams.get('id'));
    res.writeHead(out.status, { 'Referrer-Policy': 'strict-origin-when-cross-origin', ...out.headers });
    return res.end(req.method === 'HEAD' ? undefined : out.body);
  }
  // Any provider's video still (YouTube, Vimeo, TikTok), the same way (api/media-thumb.js, lib/videos.js).
  if (url.pathname === '/api/media-thumb') {
    const out = await videos.mediaThumb(url.searchParams.get('p'), url.searchParams.get('id'));
    res.writeHead(out.status, { 'Referrer-Policy': 'strict-origin-when-cross-origin', ...out.headers });
    return res.end(req.method === 'HEAD' ? undefined : out.body);
  }
  // The sitemap is written by the build step; locally it is made on request, dated today, from the same code.
  if (url.pathname === '/sitemap.xml') return send(200, site.sitemapXml(), TYPES['.xml'], { 'Cache-Control': 'public, max-age=0, must-revalidate' });
  if (url.pathname === '/llms.txt') return send(200, site.llmsTxt(), 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=0, must-revalidate' });
  if (url.pathname === '/api/faa-plans') {
    try { return send(200, JSON.stringify(await api[url.pathname](url.searchParams)), TYPES['.json'], { 'Cache-Control': FAA_PLANS_CACHE }); }
    catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json'], { 'Cache-Control': 'no-store' }); }
  }
  if (api[url.pathname]) {
    try { return send(200, JSON.stringify(await api[url.pathname](url.searchParams)), TYPES['.json']); }
    catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json']); }
  }

  // The plain /stacks/ pages: written into public/ by the build step; locally rendered on request from the same code.
  // Directory URLs end in a slash (the canonical form); without one they redirect, as vercel.json does.
  if (url.pathname === '/stacks' || url.pathname.startsWith('/stacks/')) {
    if (/^\/stacks(\/[a-z0-9-]+)?$/.test(url.pathname)) return send(308, '', 'text/plain', { Location: url.pathname + '/' + url.search });
    const html = await require('./scripts/build-stacks-pages.cjs').pageFor(url.pathname);
    return html ? send(200, html, TYPES['.html'], { 'Cache-Control': 'public, max-age=0, must-revalidate' }) : send(404, 'Not found', 'text/plain');
  }

  // Anything that is not a file of the site gets the 404 page, as on Vercel (public/404.html).
  const notFound = () => fs.readFile(path.join(ROOT, '404.html'), (e, page) => (e ? send(404, 'Not found', 'text/plain')
    : send(404, req.method === 'HEAD' ? undefined : page, TYPES['.html'], { 'Cache-Control': 'public, max-age=0, must-revalidate' })));
  // Clean addresses, as in vercel.json: /library is library.html, and the old ".html" address redirects for good.
  const old = /^\/(index|[a-z]+)\.html$/.exec(url.pathname);
  if (old && (old[1] === 'index' || CLEAN_PAGES.includes(old[1]))) return send(308, '', 'text/plain', { Location: (old[1] === 'index' ? '/' : '/' + old[1]) + url.search });
  let rel;
  try { rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '') || 'index.html'; } catch { return notFound(); }
  if (CLEAN_PAGES.includes(rel)) rel += '.html';
  const file = path.join(ROOT, rel);
  const top = rel.split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.includes(top)) return notFound();
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound();
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
    try { const css = require('./scripts/build-css.cjs'); if (css.stale()) { css.buildCss(); console.log('compiled styles/site.css and the page bundles'); } }
    catch (err) { console.warn('styles/site.css not built: ' + err.message.split('\n')[0]); }
  }
  server.listen(PORT, () => console.log(`Gatecast running at http://localhost:${PORT}`));
}
module.exports = { parseFaa, server };
