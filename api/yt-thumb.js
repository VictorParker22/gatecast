// Vercel function for /api/yt-thumb?id=<11 characters>: a YouTube video's still image, fetched by Gatecast from
// i.ytimg.com so a visitor's browser contacts nobody but Gatecast until they press Play. Logic lives in lib/youtube.js.
const youtube = require('../lib/youtube.js');
module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).send('Method not allowed');
  }
  const id = new URL(req.url, 'http://localhost').searchParams.get('id');
  const out = !require('../lib/videos.js').stillRequestAllowed(req.headers) ? require('../lib/videos.js').stillRefused() : await youtube.thumbFor(id);
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.setHeader('Vary', require('../lib/videos.js').STILL_VARY); // the shared cache keeps a refusal and a picture apart
  res.status(out.status);
  return req.method === 'HEAD' ? res.end() : res.end(out.body);
};
