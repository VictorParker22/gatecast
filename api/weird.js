// Vercel function for /api/weird. Logic lives in lib/weird.js.
// With ?view=weekly or ?view=feed it serves the /weekly/ pages and /feed.xml instead (lib/weekly.js, reached through
// the rewrites in vercel.json): Vercel Hobby allows 12 functions, all in use. Without view the JSON is unchanged.
const weird = require('../lib/weird.js');
const weekly = require('../lib/weekly.js');
module.exports = async (req, res) => {
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    if (weekly.isView(q.get('view'))) {
      const out = await weekly.render(q);
      res.statusCode = out.status;
      res.setHeader('Content-Type', out.type);
      res.setHeader('Cache-Control', out.cacheControl);
      res.end(req.method === 'HEAD' ? undefined : out.body);
      return;
    }
    const body = await weird.weirdFor(q);
    res.setHeader('Cache-Control', q.get('debug') ? weird.DEBUG_CACHE_CONTROL : weird.CACHE_CONTROL);
    res.status(200).json(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'upstream unavailable' });
  }
};
