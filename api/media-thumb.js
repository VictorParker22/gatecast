// Vercel function for /api/media-thumb?p=<provider>&id=<reference>: a video's still image from the provider's own
// image host (YouTube, Vimeo, TikTok), fetched by Gatecast so a visitor's browser contacts nobody but Gatecast until
// they press Play. /api/yt-thumb keeps working for YouTube. Logic lives in lib/videos.js; the per-provider host
// allowlist is THUMB_HOSTS in js/mediaproviders.js.
const videos = require('../lib/videos.js');
module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).send('Method not allowed');
  }
  const q = new URL(req.url, 'http://localhost').searchParams;
  const out = await videos.mediaThumb(q.get('p'), q.get('id'));
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.status(out.status);
  return req.method === 'HEAD' ? res.end() : res.end(out.body);
};
