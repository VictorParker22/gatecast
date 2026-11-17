// Vercel function for /api/books: data/books.json with the books authors and publishers put forward (approved by the
// editor) and the Book of the Week. Logic lives in lib/stacks-db.js. GET only; on any database failure it still
// answers 200 with the static data and featured: null.
const stacks = require('../lib/stacks-db.js');
module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  let out;
  try {
    out = await stacks.booksFor();
  } catch {
    out = { body: stacks.mergeBooks(require('../data/books.json'), { books: [], featured: null }), cacheControl: stacks.FAIL_CACHE_CONTROL };
  }
  res.setHeader('Cache-Control', out.cacheControl);
  res.status(200).json(out.body);
};
