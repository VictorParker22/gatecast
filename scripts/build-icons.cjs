#!/usr/bin/env node
// The site icons, drawn from the brand mark (docs/design-system.md, "Brand"): the gate arch with its centre line, white,
// on a cobalt square with an ink edge. Writes, at the repo root (copied to the site root by scripts/build-data.cjs):
//   favicon.svg            the icon for browsers that take SVG (and for Google Search, which accepts SVG)
//   favicon.ico            16, 32 and 48 px (PNG inside an ICO), for /favicon.ico and older browsers
//   apple-touch-icon.png   180 px, full bleed (iOS rounds the corners itself)
//   icon-512.png           512 px with a finer ink edge, the logo in the JSON-LD (Organization.logo)
//   node scripts/build-icons.cjs
// The PNGs are rendered by Chromium through Playwright, which is not a project dependency: it is only needed to
// redraw the icons, and the results are committed, so the build never runs this.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const COBALT = '#1C36C7'; // --np-cobalt (day)
const INK = '#15120E'; // --np-ink (day)
const ON = '#FFFFFF'; // --np-on-cobalt (day)
const GLYPH = '<path d="M5 20V9a7 7 0 0 1 14 0v11"/><path d="M12 13v7"/>'; // 24-unit grid, as in the header mark

// The mark in a 32-unit box: the ink edge drawn inside the square, the glyph placed as the header places it.
// edge: the ink edge's width in units (0 for none).
function markSvg({ edge = 2, scale = 1, stroke = 2.6 } = {}) {
  const off = 16 - 12 * scale; // keeps the 24-unit glyph centred however it is scaled
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <title>Gatecast</title>
  <rect ${edge ? `x="${edge / 2}" y="${edge / 2}" width="${32 - edge}" height="${32 - edge}" stroke="${INK}" stroke-width="${edge}"` : 'width="32" height="32"'} fill="${COBALT}"/>
  <g transform="translate(${off} ${off + scale}) scale(${scale})" fill="none" stroke="${ON}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${GLYPH}</g>
</svg>
`;
}

// An ICO file holding PNG images (supported by every browser that matters, and by Windows since Vista).
function icoFrom(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

async function main() {
  const { chromium } = require('playwright');
  const favicon = markSvg();
  fs.writeFileSync(path.join(root, 'favicon.svg'), favicon);
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  // At 16 px the stroke is thickened a little so the arch survives the downscale.
  const ico = [];
  for (const size of [16, 32, 48]) ico.push({ size, data: await render(page, size === 16 ? markSvg({ stroke: 3 }) : favicon, size) });
  fs.writeFileSync(path.join(root, 'favicon.ico'), icoFrom(ico));
  fs.writeFileSync(path.join(root, 'apple-touch-icon.png'), await render(page, markSvg({ edge: 0, scale: 0.8, stroke: 2.4 }), 180));
  fs.writeFileSync(path.join(root, 'icon-512.png'), await render(page, markSvg({ edge: 1 }), 512));
  await browser.close();
  console.log('wrote favicon.svg, favicon.ico (16, 32, 48), apple-touch-icon.png (180), icon-512.png (512)');
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
module.exports = { markSvg, icoFrom };
