// The three full-page pictures, 1920x1080, from the site running locally (node server.js at http://localhost:4173):
//   node capture/pages.cjs [high|low]   -> src/images/hero.png, book.png, back.png
// 'high' is the full 3D room. In software rendering (no graphics card) it takes about two minutes a picture.
// Requests to other sites are blocked, so the book shows the site's own stand-in cover, not a publisher's.
const { chromium } = require('playwright');
const D = require('node:path').join(__dirname, '..', 'src', 'images') + '/';
const tier = process.argv[2] || 'high';
const CARD = [{ id: 'in-cold-blood', at: Date.parse('2026-11-17') }, { id: 'the-devil-in-the-white-city', at: Date.parse('2026-11-12') }, { id: 'killers-of-the-flower-moon', at: Date.parse('2026-11-03') }];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const open = async (hash, card) => {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await ctx.route((u) => !/^http:\/\/localhost/.test(u.href), (r) => r.abort());
    await ctx.addInitScript((c) => { try { localStorage.setItem('gatecast:library-card', JSON.stringify(c)); } catch {} }, card);
    const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 120)));
    await p.goto(`http://localhost:4173/library.html?stacks=${tier}${hash}`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.documentElement.classList.contains('s3d-ready'), null, { timeout: 600000 }).catch(() => console.log('not ready'));
    return { ctx, p };
  };
  const snap = (p, name) => p.screenshot({ path: `${D}${name}.jpg`, type: 'jpeg', quality: 93, timeout: 600000 }).then(() => console.log('saved', name, new Date().toISOString().slice(11, 19)));
  { const { ctx, p } = await open('', CARD); await p.waitForTimeout(tier === 'high' ? 20000 : 6000); await snap(p, 'hero'); await ctx.close(); }
  { const { ctx, p } = await open('#book=in-cold-blood', CARD);
    await p.waitForSelector('#lib-dlg[open]', { timeout: 600000 }).catch(() => console.log('no dialog'));
    await p.waitForTimeout(tier === 'high' ? 30000 : 9000); await snap(p, 'book');
    await p.click('#bk-turn', { timeout: 120000 }).catch((e) => console.log('no turn', String(e).slice(0, 80)));
    await p.waitForTimeout(tier === 'high' ? 30000 : 9000); await snap(p, 'back'); await ctx.close(); }
  await b.close();
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
