// Vercel function for /api/book-covers. Logic lives in lib/books.js.
const books = require('../lib/books.js');
module.exports = async (req, res) => {
  try {
    const only = new URL(req.url, 'http://localhost').searchParams.get('only');
    // ?only= is the owner's tool (it skips the shared cache): on the live site it needs the owner's key.
    if (only !== null && require('../lib/site.js').ownerTool(new URL(req.url, 'http://localhost').searchParams.get('key'))) {
      res.setHeader('Cache-Control', 'no-store');
      const parsed = books.parseOnly(only);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      return res.status(200).json(await books.coversOnly(parsed.ids));
    }
    const out = await books.coversFor();
    res.setHeader('Cache-Control', books.cacheControlFor(out));
    res.status(200).json(out);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'upstream unavailable' });
  }
};
