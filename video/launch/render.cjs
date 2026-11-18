// Renders the video without a screen: starts the Motion Canvas editor (vite), opens it in headless Chromium, presses
// Render, and waits for output/project.mp4. The settings (1920x1080, 30 fps, MP4 through FFmpeg) are in src/project.meta.
//   node render.cjs            (needs: npm install here, and Playwright's Chromium on the machine)
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PORT = 9000;
const OUT = path.join(__dirname, 'output', 'project.mp4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(OUT, { force: true });
  const vite = spawn(process.execPath, [path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; vite.stdout.on('data', (d) => { log += d; }); vite.stderr.on('data', (d) => { log += d; });
  let browser;
  try {
    for (let i = 0; i < 60 && !/Local:/.test(log); i++) await sleep(250);
    if (!/Local:/.test(log)) throw new Error('vite did not start:\n' + log);
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
    await page.route((u) => !/^http:\/\/localhost/.test(u.href), (r) => r.abort()); // the editor's update check
    page.on('pageerror', (e) => { if (!/Failed to fetch/.test(e.message)) console.log('page error:', e.message.slice(0, 300)); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('console:', m.text().slice(0, 300)); });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    const button = page.locator('button', { hasText: /^render$/i }).first();
    await button.waitFor({ timeout: 60000 });
    await sleep(3000); // let the scene and its pictures load before the first frame
    await button.click();
    const t0 = Date.now();
    await sleep(2000);
    for (;;) { // the button reads "Abort" while it renders
      const label = (await button.textContent().catch(() => '')) || '';
      if (/render/i.test(label) && fs.existsSync(OUT)) break;
      if (Date.now() - t0 > 30 * 60 * 1000) throw new Error('render did not finish in 30 minutes');
      await sleep(1000);
    }
    let size = -1; // wait for FFmpeg to finish writing
    for (let i = 0; i < 120; i++) { const s = fs.statSync(OUT).size; if (s === size && s > 0) break; size = s; await sleep(1000); }
    console.log(`rendered ${OUT} (${fs.statSync(OUT).size} bytes) in ${Math.round((Date.now() - t0) / 1000)} s`);
  } finally {
    if (browser) await browser.close();
    vite.kill();
  }
})().catch((e) => { console.error(String(e && e.stack || e).slice(0, 800)); process.exit(1); });
