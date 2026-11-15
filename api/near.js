// Vercel function for /api/near. Logic lives in lib/live.js.
const { api } = require('../lib/live.js');
module.exports = async (req, res) => {
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    res.status(200).json(await api['/api/near'](q));
  } catch (err) {
    res.status(502).json({ error: 'upstream unavailable' });
  }
};
