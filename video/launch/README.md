# The Stacks launch video

A 31-second, 1920x1080, silent video about the library, made with [Motion Canvas](https://github.com/motion-canvas/motion-canvas) 3.17.2 (MIT). The finished file is `docs/video/the-stacks-launch.mp4`. This folder is its source, so it can be changed and rendered again. It is not part of the site build or the site's tests, and has its own `package.json`.

## What is in it

| Seconds | Picture | Words |
|---|---|---|
| 0 to 5 | The room, dark | Some stories are true. Some only say they are. |
| 5 to 10 | The library page | The Stacks: 78 books on eight shelves, picked by our editor. |
| 10 to 16 | A book pulled out, then turned over | Pull a book out. Turn it over for what it's about, in our own words. |
| 16 to 21 | The "Worth knowing" note from that book | Where a true story bends the truth, we say so. |
| 21 to 26 | The library card with three stamps | Borrow a book. Your card gets stamped. No account. Kept on your device only. |
| 26 to 31 | End card | The Stacks. Open all night. www.thegatecast.com. Made by ORYNTLabs LLC. |

Every picture is a real screenshot of `library.html`. The typefaces are the site's own (`vendor/fonts/`), the colours are the room's theme colours, and every sentence is one the site already says or a fact from `data/books.json` (78 books, 8 shelves). If those numbers change, change the caption in `src/scenes/launch.tsx`.

The book shown has the site's own stand-in cover, not a publisher's cover: the screenshots are taken with requests to other sites blocked.

## Render it again

```bash
cd video/launch
npm install
node render.cjs
```

`render.cjs` starts the Motion Canvas editor, opens it in headless Chromium (Playwright must be installed on the machine), presses Render and waits for `output/project.mp4` (about two minutes). Copy that file to `docs/video/the-stacks-launch.mp4`. The settings (size, 30 frames a second, MP4 through FFmpeg) are in `src/project.meta`.

To work on it with the editor's preview instead, run `npm run serve` and open http://localhost:9000.

## Take the screenshots again

With the site running locally (`node server.js` in the repo root, http://localhost:4173):

```bash
node capture/pages.cjs high
node capture/crops.cjs
```

`pages.cjs` writes `src/images/hero.jpg`, `book.jpg` and `back.jpg`; `crops.cjs` writes `card.png` and `note.png`. Without a graphics card the full 3D room takes about two minutes a picture.

## Not done

- No sound or music.
- One size only. A vertical cut for phones would need its own layout.
