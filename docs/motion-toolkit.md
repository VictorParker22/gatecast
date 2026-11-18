# Motion and graphics toolkit

Eleven free tools for motion graphics and drawing on the web, from a list the owner sent on 18 Nov 2026, each checked
for Gatecast: what it does, its licence, how much code it adds, and whether The Stacks (`library.html`) uses it.

Sizes are measured, not quoted: each package was bundled on its own with esbuild 0.28.2 (minified) and gzipped, from
the npm versions listed, on 18 Nov 2026. Licences are read from each package's own `package.json` and licence file.

## Summary

| Tool | What it is | Licence | Size (min / gzip) | Verdict for The Stacks |
|---|---|---|---|---|
| [Rough.js](https://github.com/pshihn/rough) 4.6.6 | Hand-drawn, sketchy shapes as SVG or canvas | MIT | 28 kB / 9 kB | **In use** |
| [Zdog](https://github.com/metafizzy/zdog) 1.1.3 | Small pseudo-3D engine with round, flat shapes | MIT | 28 kB / 8 kB | **In use** |
| [Flubber](https://github.com/veltman/flubber) 0.4.2 | Morphs one SVG shape into another | MIT | 54 kB / 19 kB | Not yet: no shape on the page changes into another |
| [Theatre.js](https://github.com/theatre-js/theatre) core 0.7.2 | Animation sequencing with a visual editor | Apache-2.0 | 107 kB / 35 kB | No: GSAP, already on the page, does the same job |
| [tsParticles](https://github.com/tsparticles/tsparticles) 4.6.0 (slim) | Particle effects (dust, snow, confetti) | MIT | 165 kB / 50 kB | No: the room already has its own dust shader |
| [Lottie](https://github.com/airbnb/lottie-web) 5.13.0 (light) | Plays animations exported from After Effects | MIT | 172 kB / 49 kB | No: needs animations made in After Effects, which we do not have |
| [Hydra](https://github.com/hydra-synth/hydra-synth) 1.4.0 | Live-coded video synthesiser | AGPL | 187 kB / 60 kB | No: the licence would put its terms on the whole site |
| [WebGL Fluid](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (npm `webgl-fluid` 0.4.0) | Interactive smoke and ink simulation | MIT | 28 kB / 7 kB | No: a second WebGL scene beside the room, with nothing to say |
| [LYGIA](https://github.com/patriciogonzalezvivo/lygia) 1.4.1 | Library of shader functions | Prosperity (non-commercial) and Patron | shader source | No: free use is non-commercial only |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas) 3.17.2 | Makes videos from code, with an editor | MIT | not a page library | **In use** for the launch video |
| [Remotion](https://github.com/remotion-dev/remotion) 4.0.544 | Makes videos with React | Own licence, free for small teams | not a page library | Not used: the video is made with Motion Canvas |

## In use

### Rough.js: the ink on the library card

- Each date stamp on the library card has a hand-inked outline instead of a straight border, turned a little
  differently for each book. The wobble and the tilt come from a seed made from the book and the time it was stamped
  (`inkSeed`, `stampTilt` in `js/librarymodel.js`), so a stamp looks the same on every visit.
- The "Worth knowing." label on a book's back cover has a pencil line under it.
- Vendored in `vendor/roughjs/`, loaded after the page is up as its own file. Without it the stamps keep their plain
  border. The drawings use the ink colour the text already has.

### Zdog: the rubber stamp on an empty card

- An empty library card shows a small rubber stamp beside its sentence. It turns once when it appears, and once again
  each time the card is opened or the pointer comes onto it, then rests. With reduced motion it is drawn still.
- Its colours are read from the room's theme tokens (leather, brass, red ink), so it follows the theme.
- Vendored in `vendor/zdog/` (the package ships CommonJS only; the README there says how the one-file ES module was
  made), loaded when the browser is idle. Without it the card is as it was.

### Motion Canvas: the launch video

- `docs/video/the-stacks-launch.mp4`: 31 seconds, 1920x1080, silent, made from real screenshots of the library with the
  site's typefaces and wording.
- Its source is in `video/launch/` with its own `package.json`, outside the site build. `node render.cjs` there renders
  it again without a screen; the README there has the storyboard and how the screenshots are taken.

## Not in use, and what would change that

- **Flubber.** Worth it when a shape must turn into another: for example a shelf's emblem changing as the shelf
  changes. Nothing on the page does that today, and 19 kB for a button icon is poor value.
- **Theatre.js.** Its strength is the visual editor for choreographing 3D scenes. The room's moves (pulling a book out,
  panning) are short and already written with GSAP. It becomes worth it if the room gets a long authored sequence, such
  as an opening shot.
- **tsParticles.** Would only repeat what the room's own dust shader does, at 50 kB.
- **Lottie.** A player for animations designed elsewhere. Useful if a designer ever supplies some.
- **Hydra.** AGPL: using it on the site would require the whole site to be offered under AGPL terms. The site's licence
  is still the owner's decision, so this stays out.
- **WebGL Fluid.** Small and MIT, but it is a second WebGL scene. The visitors who get the simple shelves (no 3D) are
  the ones on weak devices, with data saving on, or who asked for less motion: the wrong audience for a fluid simulation.
- **LYGIA.** Its free licence covers non-commercial use and a 30-day commercial trial. Gatecast is made by a company, so
  using it needs the Patron licence (sponsoring the author). The room's shaders are short and written by hand.
- **Remotion.** Makes video files with React. The launch video uses Motion Canvas instead, which is MIT with no limit
  on company size; Remotion is free only for individuals and for companies with up to three employees.

## Rules for adding one

- Vendor it under `vendor/<name>/` with its licence and a README line; never load it from a CDN.
- Name it in `library.html`'s import map and in `scripts/build-js.cjs`.
- Load it with a dynamic `import()` after the page is up, and make the page work without it.
- Take colours from the theme tokens, respect `prefers-reduced-motion`, and keep decoration hidden from screen readers.
