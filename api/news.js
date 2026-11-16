// Vercel function for /api/news. Logic lives in lib/news.js.
const news = require('../lib/news.js');
module.exports = async (req, res) => {
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    res.setHeader('Cache-Control', news.CACHE_CONTROL);
    res.status(200).json(await news.newsFor(q));
  } catch (err) {
    res.status(502).json({ error: 'upstream unavailable' });
  }
};
