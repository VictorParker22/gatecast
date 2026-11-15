// Vercel function for /api/metar. Logic lives in lib/live.js.
const { api } = require('../lib/live.js');
module.exports = async (req, res) => {
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json(await api['/api/metar'](q));
  } catch (err) {
    res.status(502).json({ error: 'upstream unavailable' });
  }
};
