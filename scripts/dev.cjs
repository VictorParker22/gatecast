// npm run dev: the local server plus the Tailwind CLI in watch mode, so styles/site.css and styles/console.css follow every edit to
// styles/main.css, styles/components/*.css and the class names in the pages and scripts it scans.
const { watchCss, buildCss, stale } = require('./build-css.cjs');
if (stale()) buildCss();
const watchers = watchCss();
process.env.GATECAST_NO_CSS = '1';
require('../server.js').server.listen(Number(process.env.PORT) || 4173, () => console.log(`Gatecast running at http://localhost:${Number(process.env.PORT) || 4173} (CSS watching)`));
const stop = () => { for (const w of watchers) w.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
