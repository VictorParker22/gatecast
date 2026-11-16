// Vercel function for /api/faa-plans?airports=JFK,LGA: what the FAA plans for those US airports today
// (ATCSCC operations plan and NAS Status airport events). Logic lives in lib/live.js.
const { api, FAA_PLANS_CACHE } = require('../lib/live.js');
module.exports = async (req, res) => {
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const body = await api['/api/faa-plans'](q);
    res.setHeader('Cache-Control', FAA_PLANS_CACHE);
    res.status(200).json(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'upstream unavailable' });
  }
};
