#!/usr/bin/env node
// Gatecast server: serves the static site and proxies the live sources that do not
// send CORS headers (NOAA airport observations, FAA airport status). No dependencies.
//   node server.js            -> http://localhost:4173
//   PORT=8080 node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 4173;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8',
};
const PUBLIC = ['index.html', 'flights.html', 'trip.html', 'styles', 'js', 'data', 'vendor'];

const { api, parseFaa } = require('./lib/live.js');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, body, type) => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    res.end(body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', 'text/plain');

  if (api[url.pathname]) {
    try { return send(200, JSON.stringify(await api[url.pathname](url.searchParams)), TYPES['.json']); }
    catch (err) { return send(502, JSON.stringify({ error: 'upstream unavailable' }), TYPES['.json']); }
  }

  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  const top = rel.split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.includes(top)) return send(404, 'Not found', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(404, 'Not found', 'text/plain');
    send(200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`Gatecast running at http://localhost:${PORT}`));
module.exports = { parseFaa, server };
