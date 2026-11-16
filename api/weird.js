// Vercel function for /api/weird. Logic lives in lib/weird.js.
const weird = require('../lib/weird.js');
module.exports = async (req, res) => {
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const body = await weird.weirdFor(q);
    res.setHeader('Cache-Control', q.get('debug') ? weird.DEBUG_CACHE_CONTROL : weird.CACHE_CONTROL);
    res.status(200).json(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'upstream unavailable' });
  }
};
