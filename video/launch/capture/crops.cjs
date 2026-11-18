// The library card with stamps and the "Worth knowing" note, as sharp crops (simple shelves, 3x), from the site
// running locally (node server.js at http://localhost:4173):
//   node capture/crops.cjs   -> src/images/card.png, note.png
const { chromium } = require('playwright');
const D = require('node:path').join(__dirname, '..', 'src', 'images') + '/';
const CARD = [{ id: 'in-cold-blood', at: Date.parse('2026-11-17') }, { id: 'the-devil-in-the-white-city', at: Date.parse('2026-11-12') }, { id: 'killers-of-the-flower-moon', at: Date.parse('2026-11-03') }];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1528, height: 900 }, deviceScaleFactor: 3 });
  await ctx.route((u) => !/^http:\/\/localhost/.test(u.href), (r) => r.abort());
  await ctx.addInitScript((c) => { try { localStorage.setItem('gatecast:library-card', JSON.stringify(c)); } catch {} }, CARD);
  const p = await ctx.newPage();
  await p.goto('http://localhost:4173/library.html?stacks=dom', { waitUntil: 'load' });
  await p.waitForTimeout(3000);
  // A few pixels are trimmed where the page behind shows at the element's edge.
  const crop = async (sel, file, left, top) => { const r = await p.locator(sel).boundingBox(); await p.screenshot({ path: D + file, clip: { x: r.x + left, y: r.y + top, width: r.width - left, height: r.height - top } }); };
  await crop('#lib-card', 'card.png', 6, 0);
  await p.evaluate(() => { location.hash = '#book=in-cold-blood'; });
  await p.waitForTimeout(2500); await p.click('#bk-turn'); await p.waitForTimeout(2000);
  await crop('#bk-caveat', 'note.png', 0, 2.34);
  const dims = await p.evaluate(() => ['#lib-card', '#bk-caveat'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height)]; }));
  console.log(JSON.stringify(dims));
  await b.close();
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
