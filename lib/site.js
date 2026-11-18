// The site's address, written once. The build (scripts/build-data.cjs: sitemap.xml, llms.txt;
// scripts/build-stacks-pages.cjs: the /stacks/ pages), the weekly pages and the feed (lib/weekly.js), the IndexNow
// script and the book-cover requests (lib/books.js) all read it from here.
//
// The www form, https, no trailing slash: it is the address Vercel serves (thegatecast.com redirects to it), so
// every canonical points at a page that answers 200. If the bare domain is ever made the main one in Vercel,
// change it here and in the hand-written pages together. The pages written by hand (index.html, library.html, how.html,
// trip.html, flights.html), robots.txt, js/tvmodel.js (a browser module) and the Supabase functions cannot read
// this file, so they spell the address out; tests/seo.test.mjs checks that each of them agrees with it.
//
// The site moved here from https://gatecast.vercel.app on 18 Nov 2026 (docs/seo/domain-move.md). The old address
// still answers and stays in the functions' allowed origins.
const SITE_ORIGIN = 'https://www.thegatecast.com';
const PREVIOUS_ORIGIN = 'https://gatecast.vercel.app';

module.exports = { SITE_ORIGIN, PREVIOUS_ORIGIN };
