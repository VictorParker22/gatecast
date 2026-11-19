// The browser protection headers the site sends with every response, written once. vercel.json carries them as
// literal values for the live site (tests/security-headers.test.mjs checks they match this file and the pages),
// and server.js sends the same ones locally, so a page that works here works there.
//
// What each one is for:
//   Content-Security-Policy   which scripts may run and where a page may be framed or post a form (below)
//   X-Content-Type-Options    a file is never guessed to be a script or a stylesheet
//   X-Frame-Options           older browsers: the site cannot be put in a frame on another site (clickjacking)
//   Referrer-Policy           other sites learn only our address, never the page or its query
//   Permissions-Policy        no camera, microphone, payment or USB for us or anything we embed; location is ours only
//   Cross-Origin-Opener-Policy  a page we link to cannot reach back into ours
//
// The policy's shape. Scripts are the strict part: only our own files, the few inline scripts in the pages (each named
// by its hash, so an injected one does not run), WebAssembly for the 3D library's decoders, and the two outside
// scripts the pages load on request (X's widget for an embedded post, Google Books' viewer for "Look inside").
// No 'unsafe-inline' and no 'unsafe-eval'. Pictures, video, frames and data may come from any https address, because
// stories link pictures and players from many outlets; that is the loose part, on purpose.
const crypto = require('node:crypto');

// Outside scripts, by exact host: X's embed widget and what it fetches as script; Google Books' viewer.
const SCRIPT_HOSTS = [
  'https://platform.twitter.com', 'https://cdn.syndication.twimg.com', 'https://syndication.twitter.com',
  'https://www.google.com', 'https://books.google.com', 'https://www.gstatic.com',
];

// Every inline script a browser would run in this HTML: not one with src, not JSON-LD (data, never run).
// An import map counts: it is checked like a script.
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)(?![^>]*\btype="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/gi;
function inlineScriptHashes(html) {
  const out = new Set();
  for (const m of String(html).matchAll(INLINE_SCRIPT)) out.add(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  return [...out];
}

// hashes: the inline scripts allowed, as 'sha256-…' tokens. upgrade: send http requests as https (off locally, where
// the site itself is http).
function contentSecurityPolicy(hashes, { upgrade = true } = {}) {
  const list = [...new Set(hashes)].sort();
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${list.join(' ')} ${SCRIPT_HOSTS.join(' ')}`.replace(/\s+/g, ' '),
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' data: blob: https:",
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://buttondown.com",
    "frame-ancestors 'self'",
    ...(upgrade ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

function securityHeaders(hashes, opts) {
  return [
    ['Content-Security-Policy', contentSecurityPolicy(hashes, opts)],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'SAMEORIGIN'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=(), midi=(), display-capture=(), geolocation=(self)'],
    ['Cross-Origin-Opener-Policy', 'same-origin-allow-popups'],
  ];
}

module.exports = { SCRIPT_HOSTS, inlineScriptHashes, contentSecurityPolicy, securityHeaders };
