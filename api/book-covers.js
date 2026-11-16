// Vercel function for /api/book-covers. Logic lives in lib/books.js.
const books = require('../lib/books.js');
module.exports = async (req, res) => {
  try {
    const out = await books.coversFor();
    res.setHeader('Cache-Control', books.cacheControlFor(out));
    res.status(200).json(out);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'upstream unavailable' });
  }
};
