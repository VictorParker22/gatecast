# Gatecast design system

The visual language and components of the Gatecast site. Every page is styled with **Tailwind CSS v4** (since 16–17 Nov 2026): the tokens are a Tailwind theme in `styles/main.css`, the shared pieces are a small component layer in `styles/components/`, and pages are styled with utilities plus those components. Every page links the compiled `styles/site.css`; the front page, The Stacks and the reviewer console add one bundle of their own components each (`site-front.css`, `site-library.css`, `console.css`), so the other pages do not download them. There is no hand-written stylesheet left.

The direction (approved 16 Nov 2026) is **a late-90s weird-news front page, modern underneath**: newsprint paper, hard 2px ink edges, offset shadows, beveled buttons that press in, a slab masthead, pixel-type datelines, starbursts and stickers, and a ticker. Underneath it stays accessible, fast and responsive: semantic HTML, 44px targets, visible focus, 4.5:1 text, `prefers-reduced-motion` respected, no framework; the only build step for styles is the Tailwind compile. The approved boards are `WeirdHome` (1440px) and `WeirdPhone` (390px); the front page is built to them and checked against them (see "Fidelity" below).

## How the theme works (Tailwind CSS v4)

**Files.** `styles/main.css` is the entry: `@import "tailwindcss" source(none)` plus the `@source` list of pages and scripts to scan, the `@theme static` block (every token, defined in `site.css` on every page), `@custom-variant dark`, the fonts, `@layer base` (element defaults on top of Tailwind's preflight) and the imports of `styles/components/site.css` (header, nav and phone tab bar, footer, buttons, settings window, fields, pills, risk chips, reading-page pieces) and `styles/components/weather.css` (verdict, stop card, facts, hourly strip, live rows, route map, panel, ink panel, and the Trips and Flights pieces that have states). `scripts/build-css.cjs` compiles it with the Tailwind CLI into one minified `styles/site.css` (local, git-ignored) and `public/styles/site.css` (the Vercel build). Three page bundles compile separately, each through a small entry that `@reference`s `main.css` (same theme and variants, nothing emitted twice): `main-front.css` → `site-front.css` (`components/front.css`), `main-library.css` → `site-library.css` (`components/library.css`) and `main-console.css` → `console.css` (`components/review.css`), so a page only carries its own bespoke pieces; daisyUI 5 is loaded there only, with the prefix `d-` and a `gatecast` theme mapped onto the newsprint tokens (`d-input`, `d-textarea`, `d-kbd`, `d-badge`).

**Tokens are utilities.** Each `@theme` variable becomes a utility: `--color-np-cobalt` gives `bg-np-cobalt`, `text-np-cobalt`, `border-np-cobalt`; `--shadow-btn` gives `shadow-btn`; `--text-code` gives `text-code`; `--spacing-tap` gives `min-h-tap`, `w-tap`; `--breakpoint-nav` gives `nav:` and `max-nav:`. Tailwind's default colour palette, radii, shadows and fonts are cleared (`--color-*: initial` and so on), so only Gatecast's values exist: there is no `bg-red-500` to reach for, which enforces "risk colours are reserved".

**The night edition.** Every colour token is a `light-dark()` pair, so it follows `color-scheme` on each element: `:root` is `light dark`, the settings toggle (localStorage `color-scheme` copied into `<meta name="color-scheme">` by the inline script in each page's head) forces `light` or `dark`, and ink panels set `color-scheme: dark` on their inside so their text, muted text, hairlines, focus ring and risk hues take their night values. Nothing needs a `dark:` prefix for colour. `@custom-variant dark` exists for the rare non-colour difference and honours the same toggle and `prefers-color-scheme`. Browsers without `light-dark()` (Safari before 17.5) get the day edition, or the night edition on a dark device, from an `@supports` fallback in `main.css`.

**Risk.** A component sets `--risk` once with `risk-low`, `risk-elevated`, `risk-high`, `risk-unknown` or `risk-calm` (custom utilities, always generated because scripts build them from a level) or a level modifier (`.chip--high`, `.stop--elevated`, `.jhour--high` …); everything inside reads `var(--risk)` (`text-(--risk)`, `border-top-color: var(--risk)`, the 11–14% tints with `color-mix`). The risk hexes and their contrast are unchanged.

### The scale

| What | Scale | Notes |
|---|---|---|
| Spacing | Tailwind's 4px step: `1` 4px, `2` 8px, `3` 12px, `4` 16px, `6` 24px, `8` 32px, `12` 48px, `16` 64px, `24` 96px | The old `--space-1`…`--space-9` map to `1, 2, 3, 4, 6, 8, 12, 16, 24`. Half steps (`0.5`, `1.5`) only for hairline offsets. Named: `tap` 44px, `gutter` 16→24px fluid, `tabbar` 74px, `panel` 24→48px fluid (ink panel sides), `icon` 1.25em |
| Type | Tailwind's `xs` 12, `sm` 14, `base` 16, `lg` 18, `xl` 20, `2xl` 24, `3xl` 30, `4xl` 36, `5xl` 48 (with Tailwind's line heights, all on a 4px grid) | Named steps, each from a board or a page: `sign` 17px (VT323 minimum, nav labels), `sub` 22px (VT323 title bars, stop-card times, the live status word), `brand` 28px (header wordmark), `code` 40px (airport codes on Trips), `temp` 64px (stop-card temperature); fluid display sizes `title`, `page`, `display`, `verdict`, `verdict-hero`, `verdict-phone`, `flight`, `wxline`, `route` (each `clamp(phone, intercept + slope·vw, desktop)`) |
| Measures | `max-w-headline` 16ch, `lede` 52ch, `measure` 62ch, `read` 68ch, `frame` 80rem | |
| Radius | `rounded-sm`/`md` 2px, `rounded-lg`/`xl` 3px, `rounded-full` for risk chips only | Tailwind's larger radii do not exist |
| Shadows | `shadow-np` 4px, `shadow-np-lg` 6px, `shadow-np-hover` 8px offsets (never blurred); `shadow-bevel`, `shadow-bevel-in`; `shadow-btn`, `shadow-btn-hover`, `shadow-btn-active` (bevel + 3/4/1px) | |
| Breakpoints | `xs` 30rem, `sm` 40rem, `nav` 46rem (the phone tab bar switch), `md` 48rem, `lg` 64rem, `xl` 80rem, `wide` 84rem (the console's assistant column); page-specific: `masthead` 52rem, `desk` 56rem, `wxbox` 62.5rem (front page), `lib-tagline` 82rem (The Stacks; its photo-crop and 3D-frame breakpoints stay in px) | Container queries: `@container` with `@xl` (36rem) on the stop card |
| Strokes | `stroke-thin` 1.5, `stroke-icon` 1.7, `stroke-2`, `stroke-bold` 2.4 | Line icons on a 24-unit grid |

No raw pixel value appears in the markup or the scripts' templates. In the CSS sources the only pixel literals are the tokens themselves (radii, the print and bevel shadows), hairlines and focus rings (1–3px, the double rules), texture tiles (the 6px halftone, the 3px press lines, the 8px dashes of an untracked flight's line) and the 8px rise of the results' entrance. The hourly strip's 3/8/14px risk bars are scale steps (`h-0.75`, `h-2`, `h-3.5`).

### Adding a component

1. Try utilities in the markup first. Most layout (flex, grid, gaps, padding, type) needs nothing else.
2. Make a component only when the same piece repeats across pages or scripts, has states (risk level, `is-here`, `[aria-current]`, `:checked`), or needs descendant or pseudo-element rules. Put it in `styles/components/site.css` (site-wide), `weather.css` (Trips and Flights) or `review.css` (the console), inside `@layer components`, built with `@apply` of utilities and nested `&` rules; keep it short and comment what it is.
3. Use tokens only. If a value is new, add it to `@theme` in `main.css` with a comment saying where it comes from; never put an anonymous number in markup or CSS (no `p-[13px]`).
4. Run `npm run css` (or keep `npm run dev` running) and check both editions and a phone width.

### Migration status

Done. Phase 1 (16 Nov): `how.html`, `trip.html`, `flights.html`, `review.html` and the shared `js/view.js`, `js/ui.js`, `js/shell.js` output. Phase 2 (17 Nov): the front page (`index.html` with `js/front.js`, `js/weather.js`, `js/today.js`, `js/changes.js`, `js/civic.js`, `js/sky.js`, `js/motion.js`) on `styles/components/front.css`, and The Stacks (`library.html`, `js/library.js`) on `styles/components/library.css`. The hand-written `styles/tokens.css`, `app.css`, `home.css`, `civic.css`, `sky.css`, `motion.css`, `library.css`, `how.css`, `trip.css`, `flights.css` and `review.css` are all deleted.

**Bespoke component files.** `front.css` and `library.css` hold what is genuinely one of a kind: the masthead and its starburst, the weather box chrome and flat sky, the ticker, the lead and its burst, the Weird-o-meter needle, cards, story media (pictures, the video facade, the text-led layouts), the Stacks teaser shelf, the guestbook, the 88x31 badges, the first-load motion; and in the Stacks the torn label, the metal slab title, the paper library card, leather chips with their lamps, brass buttons, the book dialog and back cover, the book's Preview sheet (back-cover paper, leather tabs that turn brass when chosen, a click-to-play video facade and a Look inside frame; `--color-lib-sheet*`, `--shadow-lib-sheet`), the DOM fallback shelves (a grid of at most `--cols` bays, from `bayColumns()` in `js/librarymodel.js`, so 8 shelves sit as two rows of 4), the Book of the Week card above them (`.lib-feat`: the cover or the cloth stand-in, a brass kicker, the editor's one-line reason, an "Open it" brass button; on the 3D tiers it stays in the hidden layer and its button drives the showpiece on the stand), the "Suggested by the author" note (`.lib-back__origin`, `.stk-origin`) and the paper request slip for putting a book forward (`.lib-submit`, `.lib-field`: labelled fields, one error line per field with a "!" mark and red ink, never colour alone). They compile as page bundles (`styles/main-front.css` and `main-library.css`, which `@reference` `main.css`), and their tokens live in the `@theme static` block of `main.css`: the front page's fluid board values (`--text-masthead`, `--text-lead`, `--spacing-section` …, each with its 390px and 1440px values) and the Stacks' physical colours (`--color-lib-*`) and fluid values. `static` makes `site.css` define every token on every page, so a bundle can read them with `var()` without repeating them. The Stacks' frame geometry that the 3D scene reads (`.lib-cases` and its aspect-ratio breakpoints, `.lib-room__bg`, `.lib-gl`, the `is-gl` dialog rules) and its px breakpoints, which mirror `js/stacks3d/` and the photo crops, are kept exactly. `url()`s in component files are written relative to the compiled `styles/site.css`.

## Principles

1. **Real sources only.** Every story is the outlet's own headline, linked to the original. Nothing on the page is invented: no summaries we did not write as the editor, no ratings the editor did not give, no reader numbers that do not exist, no stand-in photos.
2. **Never colour alone.** A risk level is always a word, a shape and a colour together.
3. **Risk colours are reserved.** Teal (Low), amber (Elevated) and rose (High) appear only in the rounded risk chips and risk panels (verdict, alert and stop cards). The decorative palette contains no red, amber/orange or teal, so a risk colour on screen is always news about the weather.
4. **Square print, round risk.** Everything is square-cornered (2–3px at most) except risk chips, which stay pill-shaped so they read as a different kind of thing.
5. **Decoration is decoration.** Halftone dots, press lines, starbursts and stickers never carry information that is not also in text; they are `aria-hidden` and they never cover text.
6. **Plain words.** No METAR, IFR or ATC terms in the main view. Raw data sits one tap deeper.
7. **Tokens only.** Components take colour from tokens. Fixed decorative inks (sun, lime, the night bands) are tokens too.
8. **Calm collapses, risk expands.** When nothing threatens a trip, say so in one quiet line (grey text with the tick shape) and get out of the way.

## Tokens

### Colour: the newsprint system (`--np-*`)

Light is the **day edition** (newsprint paper, ink type); dark is the **night edition** (warm near-black paper, cream type and cream rules). Contrast below is on paper / card.

| Token | Day | Night | Use |
|---|---|---|---|
| `--np-paper` | `#F3EEE2` | `#1B1813` | Page (with a faint press-line texture, `--np-print`) |
| `--np-card` | `#FFFDF7` | `#26221B` | Paper cards, windows, popover |
| `--np-sunken` | `#E9E1CE` | `#322C23` | Image slots, tracks, the since-you-looked note |
| `--np-ink` | `#15120E` | `#F3EEE2` | Headlines, borders, rules (16.1 / 18.4; 15.3 / 13.7) |
| `--np-text` | `#3B362E` | `#E4DCCB` | Body copy, pixel datelines (10.3 / 11.8; 13.0 / 11.6) |
| `--np-muted` | `#4A443A` | `#CEC4B1` | Meta, captions (8.3 / 9.5; 10.2 / 9.2) |
| `--np-rule` | `#8C8475` | `#6E6658` | Dashed separators only (decorative, never text) |
| `--np-cobalt` | `#1C36C7` | `#93A2FF` | Masthead, primary buttons, title bars, link hover, focus ring (7.6 / 8.6; 7.5 / 6.7) |
| `--np-on-cobalt` | `#FFFFFF` | `#15120E` | Text on cobalt (8.7; 7.9) |
| `--np-sun` | `#FFD23F` | same | Fill only (stickers, "Change city", the ticker label, Also odd head). Text on it is `--np-on-sun` `#15120E` (12.9) |
| `--np-lime` | `#C8F03C` | same | Fill only ("Real sources only" burst, Library tab, meter lights). Text `--np-on-lime` `#15120E` (14.2) |
| `--np-night` | `#15120E` | `#0D0B08` | Always-dark bands: edition strip, ticker, streak, "How we pick", current tab. Text `--np-on-night` white, accent `--np-sun` (12.9) |
| `--np-border` | `2px solid var(--np-ink)` | | The edge of every card, window and button |
| `--np-shadow` / `-lg` / `-hover` | `4px` / `6px` / `8px` offset, no blur | black in night | Print offset shadow |
| `--np-bevel` / `--np-bevel-in` | inset light top-left, dark bottom-right / swapped | | Raised and pressed button edges |
| `--np-halftone`, `--np-halftone-lite`, `--np-print` | dot and line textures | lighter in night | Decorative textures only |
| `--np-tint-<category>` | pale cobalt / sun / paper / lime / grey | dark equivalents | Ground behind a story picture while it loads (there is no stand-in tile) |

**Decorative palette rule.** Cobalt, sun, lime, paper, ink and their tints are the only decorative colours. No red, amber/orange or teal anywhere outside risk — this includes book spines on the library shelf and category stickers.

**Semantic tokens** used by every component are mapped onto the newsprint system: `--color-bg` = paper, `--color-surface` = card, `--color-surface-sunken` = sunken, `--color-text` = ink, `--color-text-muted` = muted, `--color-accent` = ink (primary marks), `--color-focus` = cobalt, `--color-control-border` = ink, `--color-border` (`#C9C2B2` / `#4A443A`) for hairlines inside cards.

### Colour: risk (unchanged)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--risk-low` | `#0B6B5F` | `#5FD3C0` | Low risk (teal, tick in circle) |
| `--risk-elevated` | `#8F4E00` | `#F2B450` | Elevated risk (amber, triangle) |
| `--risk-high` | `#A81C48` | `#FF8AA8` | High risk (rose, octagon) |

On the new card colour: light 6.3 / 6.3 / 7.1, dark 8.7 / 8.6 / 7.1. Risk tints are derived, not stored: `color-mix(in oklab, var(--risk) 14%, var(--color-surface))`. A component sets `--risk` once from its level modifier (`.chip--high`, `.stop--high`, `.verdict--high`, `.hour--high`); `--calm` sets it to `--color-calm`. Teal, amber and rose stay apart for people with red-green colour blindness.

#### Sky (inside the weather box)

`--sky-day` … `--sky-storm` (`#1D5FD6`, `#141B3A`, `#5A6B82`, `#33415F`, `#4D6585`, `#272C42`) are the flat fallback behind the live WebGL sky in the weather box. The box's screen always runs in the dark colour scheme so its risk chips and focus ring resolve to their dark values. `--glass-*` remains for the frosted glass buttons that sit on the sky.

### Typography

Four faces, all self-hosted from `vendor/fonts/` (SIL Open Font License; latin subsets), so no visitor data goes to a font service:

- **Inter** (`--font-sans` / `--font-body`) for sentences: body, card headlines, buttons, labels.
- **Barlow Condensed** (`--font-display` / `--font-sign`, 600, 700, 800) for signage: tabs, stickers, section labels, airport codes, temperatures in lists, risk chips.
- **Alfa Slab One** (`--font-slab`) for big headlines only: the masthead, the lead story, section heads, page titles, the big temperature, the brand wordmark.
- **VT323** (`--font-pixel`) for pixel type: the edition strip, datelines and meta, the ticker, window title bars, the streak counter. **Never below 17px.** It is drawn on a pixel grid, so it is used at 17, 18, 19, 20 and 22px as on the boards (the board sizes are kept rather than snapped to 16/20/24 so the measured fidelity holds).

Display sizes interpolate linearly between the two boards: `size = clamp(phone, intercept + slope·100vw, desktop)` with `slope = (desktop − phone) / (1440 − 390)`. For example the masthead is 46px at 390 and 144px at 1440: `clamp(2.875rem, 0.6rem + 9.3333vw, 9rem)`, and never wider than its column (`min(…, 100cqi / 5.95)`, GATECAST being 5.95em wide). Body text stays fixed at 16–19px.

Preloads on the front page: Alfa Slab One, VT323, Inter and Barlow 800 (the first screen). Inner pages preload nothing new.

### Spacing, shape, motion

- Spacing: 4px base on an 8px rhythm, `--space-1` (4) to `--space-9` (96). Section gaps on the front page run 20px (phone) to 64px (desktop).
- Frame: `--frame` = `min(100% − 2 × --gutter, 80rem)`; 1280px of content with 24px gutters (16px on phones), measured from the boards.
- Radius: `--radius-sm`/`-md` 2px, `-lg`/`-xl` 3px, `--radius-pill` 999px for risk chips only.
- Elevation: offset print shadows (`--np-shadow*`), never blurred.
- Motion: buttons lift 1px on hover and press 2px in; cards lift 2px. The masthead burst turns once every 22s; the ticker scrolls at about 60px/s. Under `prefers-reduced-motion` the burst and ticker stand still (the ticker becomes a scrollable row and its pause button is removed) and nothing transitions.
- `--tap-target` 44px minimum for anything interactive.

## Components

### Risk chip (`.chip`)

| Variant | Icon | Label |
|---|---|---|
| `.chip--low` | Tick in circle | "Low risk" |
| `.chip--elevated` | Triangle with `!` | "Elevated risk" |
| `.chip--high` | Octagon with `!` | "High risk" |
| `.chip--unknown` | Question mark in circle | "No forecast" |
| `.chip--low.chip--calm` | Tick in circle | Quiet grey, no fill or border: for "calm collapses" lists |

Set as signage: Barlow Condensed 700, uppercase, pill-shaped. Not interactive. The icon is `aria-hidden`; the text carries the meaning. `chip(level, text)` in `js/ui.js` emits `chip chip--<level>`; add `chip--calm` yourself where a quiet low is wanted.

### Verdict banner (`.verdict`)

Route and date eyebrow (Barlow 600, uppercase), one-sentence headline (Barlow Condensed 700, 1.875 to 2.75rem), one-sentence reason (Inter), forecast-confidence note, "Copy link" action. A surface card with a 6px risk-coloured left rule. Calm collapses: `--low`, `--unknown` and `--loading` stay on the plain surface. Risk expands: `--elevated` and `--high` take the 11% risk tint and a tinted border. The headline receives focus after results load so screen-reader users hear the answer first.

### Stop card (`.stop`)

One per airport, in travel order. Contains role (Barlow uppercase: Departure, Connection with layover length, Arrival), airport code (Barlow 700, 1.4em) and name, local land and take-off times (Barlow 600), the weather at the relevant hour, a one-line reason, the hourly strip, and live rows. A 4px top border carries the risk colour; the chip carries the word.

The summary shows the hour of take-off or landing when risk is low, and the worst hour of the stay when it is not; the caption says which.

### Hourly strip (`.hours`)

A horizontally scrollable row of hours from three hours before to three hours after the traveller's time at the airport.

- Rows: time, sky icon, temperature, chance of rain or snow (bar plus number), gusts, risk bar.
- The hours the traveller is present are shaded and bracketed; "Land" and "Take off" mark the exact hour.
- The risk bar changes height as well as colour (3px, 8px, 14px).
- Each hour has a full sentence for screen readers and as a hover title. The strip is keyboard-focusable so it can be scrolled with arrow keys.

### Airport field (`.combo`)

Text input with `role="combobox"` and a `listbox` of suggestions.

| State | Behaviour |
|---|---|
| Typing | Suggestions ranked: exact code, city, then airport name |
| Arrow keys | Move the active option (`aria-activedescendant`) |
| Enter or tap | Selects the option |
| Escape | Closes the list |
| Blur with text | Accepts the best match |
| No match | "No airport found" row, error on submit |
| Invalid | Rose border, `aria-invalid`, message in the form's alert region |

### Buttons (`.btn`, `.bev`)

Beveled 90s buttons, at least 44px tall, square (2px), 2px ink border, a raised bevel and a 3px offset shadow; they lift 1px on hover and press 2px in on click. `--primary` (cobalt, one per view), `--sun` (sun fill, ink text), `--ink` (night fill, white text), `--ghost` (paper), `--text` (flat underlined link-style action), `--icon` (44px square, needs `aria-label`), `--glass` (on the sky only). `.bev` is the same look for links and buttons outside the `.btn` family. `.pill` is a square tag for places and examples; `.pill.is-current` is pressed in (night with sun type).

### Settings popover (`.settings`, `.segmented`)

Native `popover` opened from the header, drawn as a program window: a cobalt title bar in VT323, a paper body, ink border and offset shadow. Segmented radio groups (temperature, wind and distance, clock, appearance) are beveled square options; the checked one is pressed in. Appearance defaults to "Match device" (day or night edition).

### Route map (`.map`)

Inline SVG, no tiles or map library. Land outline from Natural Earth, great-circle arcs, one marker per airport whose shape and colour follow its risk level (circle, triangle, diamond). The same chips are repeated in the caption so nothing depends on reading the map.

### Live rows (`.live`)

Current observation ("Right now: …") with the raw METAR behind a disclosure, active National Weather Service alerts, and FAA delay programmes. Alerts use the elevated tint with its icon.

### Weather box (`.wxbox`, `.sky`)

An old program window in the masthead: a cobalt title bar ("WEATHER BOX · NEW YORK" in VT323) with a sun "Change city" button that opens the place search under it; then the screen, which holds the live WebGL sky (the flat `--sky-*` colour is its fallback) with scan lines, the big slab temperature, the condition and one plain sentence (`headlineParts()`), the next 8 hours, the nearby airports (a quiet tick line when calm, a risk chip when not) and air/UV/sunset. NWS alerts, "Since you last looked" and the newest weird-weather story sit under the screen.

### Animated sky (`js/sky.js`, `js/sky/shaders.js`, `.sky__canvas` in `styles/components/front.css`)

A WebGL canvas behind the sky header draws the weather: a sun glow that follows the time between sunrise and sunset with drifting high cloud by day, stars and a moon at night, layered overcast, rain whose density follows the forecast and whose slant follows the wind, drifting snow, and storm cloud with rare, soft brightening.

- The shader caps brightness so white text keeps at least 4.5:1 contrast everywhere.
- If WebGL is missing or fails, the canvas stays invisible and the flat sky colour shows.
- With reduced motion it draws one still frame per change, with no lightning.
- It renders at no more than 1.5 device pixels per CSS pixel and pauses when the tab is hidden or the sky is scrolled out of view.

### Motion (`js/motion.js`, the motion rules in `styles/components/front.css`)

All motion lives in its own layer so it can be tuned or removed without touching layout.

| Moment | What moves |
|---|---|
| First forecast | Place, temperature (counts up), sentence, day parts, then the board arrive in sequence in under about 700ms. It does not replay on unit changes. |
| Dragging a box | A copy lifts under the pointer with a slight tilt and shadow, its place becomes a dashed slot, the others glide aside, and it settles on release. Over the shelf it shrinks into the new shortcut. |
| Resizing a box | The box grows or shrinks while its contents cross-fade. |
| Options panel | The glass rises, scales and sharpens; on phones it comes up from the bottom. Exits are faster than entrances. |
| Quiz answer | The right option pops; a wrong pick shakes once. Ticks and crosses still carry the meaning. |

Everything becomes an instant change under `prefers-reduced-motion`, and only transform, opacity and (sparingly) filter are animated.

### Front page pieces (`index.html`, `styles/components/front.css`, `js/front.js`)

- **Edition strip** (`.edition`): a night band in VT323 sun: "NEW YORK EDITION · MONDAY 16 NOVEMBER 2026 · VOL. 1 · NO. 320". The place is the one chosen in the weather box, the date is in the visitor's locale, and "No." is simply the day of the year (`editionLine()`); nothing in it is presented as a fact about an issue. On phones it is the short form above the masthead.
- **Masthead** (`.masthead`): kicker with a double rule, the GATECAST `h1` (the page's only h1), a one-line lede, and the lime "Real sources only" starburst. The starburst has its own grid cell beside the lede, so it never covers the wordmark at any width (a deliberate change from the board, where it overlaps the last letters); it turns slowly and stands still under reduced motion.
- **Tabs** (`.tabbar`): the site nav followed by section tabs, one per category with stories (`#sections`), which filter the grid.
- **Ticker** (`.ticker`): real headlines from `/api/weird`, each a link. It pauses on hover and keyboard focus and with a labelled pause/play button (`aria-pressed`); under reduced motion it never moves and becomes a scrollable row.
- **Lead** (`.lead`): the first story (the API puts editor's picks first): a "TODAY'S LEAD · CATEGORY" tag, a sticker, the outlet's headline in Alfa Slab One, the publisher's preview image (eager, credited, hotlinked) or the video facade (see Story media), a sun starburst ("Editor's pick" for picks, otherwise "Straight from" + the outlet's monogram), the editor's note only if there is one (never a written summary), a pixel dateline, "Read it at <outlet>", the editor's rating pips only if non-null, and the Weird-o-meter.
- **Text-led lead** (`.lead--text`): a lead with neither picture nor video has no figure at all. The burst stands beside the headline in its own grid cell (`.lead__head`), and under a 3px double rule the hook is a pull quote (`--text-lead-pull`, a 6px cobalt rule on its left), with the dateline, "Read it at", the pips and the Weird-o-meter beside it (from `sm`; stacked on phones).
- **Story media** (`.smedia`, `.vplay`, `.vchip`, `.smedia__player`; markup in `js/frontmedia.js`, choice in `storyMedia()` in `js/frontmodel.js`): a story shows the publisher's picture, else a click-to-play **video facade**, else nothing (the text-led layouts). The facade is one real button over the still (served by Gatecast, `api/yt-thumb`; the 4:3 still is scaled so its letterbox bars fall outside any 16:9-to-square frame), a 64px sun play knob with an ink edge and print shadow, the length in VT323 when known, and a night credit "Video: <channel> on YouTube"; its accessible name is "Play the video: <title> (<channel> on YouTube, <length in words>)". Play swaps in the youtube-nocookie.com player and moves focus into it; the lead's burst is hidden while it plays. A picture with a video too gets the **"Has video"** control (`.vchip`: night, sun type, a sun knob, 44px tall) in its bottom-right corner. A picture that fails to load (or is a pixel) is dropped and the story is drawn again with its video or text-led. Under reduced motion nothing lifts; in forced colours the knob and chip use system colours.
- **Weird-o-meter** (`.meter`): five real 44px buttons with `aria-pressed`; the needle swings to the visitor's vote at once; the note says the readers' average appears only after 50 votes, with the count so far (`meterNote()`); a failed vote restores the previous state with a calm inline message. Votes go through `js/community.js`.
- **Also odd** and **reading streak** (`.also`, `.streak`): the next four stories (each row is the link's hit area); the streak counts calendar days on this device only, in hit-counter digits, and says so.
- **Believe it or not** (`.believe`, `.grid`, `.card`): filter chips with counts from the API, a grid of cards (`repeat(auto-fill, minmax(268px, 1fr))`; cards use `subgrid` rows so pictures, headlines, datelines and footers line up across a row), "Show N more". Cards carry a category sticker, "VIDEO AT SOURCE" when the outlet labelled it a video and there is no player, the publisher image or the video facade (see Story media), the headline link, a pixel dateline, editor pips if any, and "Read at <outlet>". A card with neither is a **text-led card** (`.card--text`): no media row; the sticker and a slab headline (`--text-card-type`, bottom-aligned) fill the top two rows of the card's subgrid over a 3px double rule, so it lines up with picture cards. There is no stand-in tile any more (removed 17 Nov 2026, with "Picture at the source"). On phones cards become rows with a 92px square thumbnail; a text-led card is a single column, and a video card shows "Video: <channel> on YouTube" in its foot and opens its player full width.
- **The brief** and **Flying?** (`.nearyou`, `.flybox`): the existing brief (NWS alerts, state headlines, statehouse votes) beside a trip box that shows a saved trip's verdict (risk chip, stop strip, "See the journey") or a From / To / Leaving form that opens `trip.html` with the check filled in.
- **Weather desk** (`#today`): what today means, 10 days and the radar for the place in the weather box.
- **The Stacks teaser** (`.libteaser`, `.shelf`, `.spine`): a CSS wooden shelf with typographic spines (In Cold Blood, Zodiac, Stiff, The Ghost Map, Bad Blood, I'll Be Gone in the Dark) linking to `library.html`; spine colours follow the decorative palette rule.
- **Guestbook and How we pick** (`.guestbook`, `.about`): a tip form (https link, optional note, a visually hidden `website` honeypot) sent through `js/community.js` ("Thanks — a person reads every tip."), beside the editorial rules.
- **Badges** (`.badge`): 88×31-style buttons in the footer, real links only (Open-Meteo, how.html, the guestbook, the library).
- **Story mode, "Gatecast TV"** (`.stv`, `.stv-*`; `js/tvscreen.js`, `js/tvmodel.js`, content from `tvHTML()` in `js/front.js`, styles in `styles/components/tv.css`, part of the front-page bundle): a story's headline, picture, favourite, Also-odd row, grid card or ticker item opens it in a full-screen native `<dialog>` instead of leaving the site (owner request, 17 Nov 2026), in the spirit of the book that leaves the shelf in The Stacks and a late-night 90s music-TV broadcast. It grows out of the clicked story (a `clip-path` from its rectangle), then a burst of canvas static and a station-ident title card (the category in Alfa Slab, rotated, in its sticker colour, with the channel number in VT323) play on the screen area only; then a zine spread of paper cut-outs drops in: the hero (category sticker, "Editor's pick", the slab headline `--text-tv-head`, a starburst on wide screens, and the outlet on cobalt + the date in VT323 on ink as a lower third), the picture or video in a glass screen (an ink bezel, rounded glass, scanlines and a glare that lift while a player runs; sticky beside the words on wide screens; tall for TikTok), the hook as a sun pull quote (`--text-tv-hook`), "In our words" (`--text-tv-words`, 1.6 line height, ≤62ch) on paper with a lime offset, the big sun "Read the full story at <outlet>" button and credits, the Weird-o-meter, and "Next on Gatecast" cards. The studio behind is always dark (`--color-tv-stage`: deep cobalt-black by day, near-black at night) with a cobalt diagonal band, halftone, scanlines and a vignette; the bar carries Gatecast TV's own bug (sun slab + lime tag), the channel and Copy link / Close; the control deck is dark plastic with speaker grilles, Prev / Next channel buttons (52px) and a channel dial. Close collapses the picture to a line and a dot. Under reduced motion there is no static, ident or drop-in, only a cross-fade (WAAPI opacity). Original design only: no network's logo, idents or graphics.
- **Story media from any provider** (`.vplay--<provider>`, `.vplay__poster`, `.smedia__orig`, `.smedia__x`): a facade with Gatecast's still (YouTube, Vimeo, TikTok) or Gatecast's own halftone poster with the provider's name in signage type (Facebook, X, Instagram; never their logos); Instagram's facade is a link out; a playing Facebook video carries "Not playing? Open it on Facebook". Rules in `js/mediaproviders.js`.
- **Favourites** (`.favs`, `.fav`): three cards under the lead, each with its hook line (`.fav__hook`) under the headline. A favourite with a picture or a video has the square media cell on the right (a video's label goes in its dateline); one with neither (`.fav--text`) drops that column and the headline takes the card's width. A playing favourite becomes a column with a full-width 16:9 player under the outlet bar. The heading names who ranked the row: "Editor's favourites", or "Reader favourites" with "— ranked by Weird-o-meter votes" in a `.favs__how` span (cobalt on wide screens, ink on a phone). See `docs/community.md`, "Reader favourites".

### Fidelity

The front page is checked against the board renders with a bounding-box script at 1440×900 and 390×844 (x and width within ±2px; type sizes and line heights exact), and swept from 320 to 2560px plus 200% zoom and reduced motion for horizontal scroll, sibling overlaps, clipped text and 44px targets. Differences that remain are intentional: real data lengths, the starburst's reserved cell, and the phone weather box keeping the next 8 hours.

### Site navigation (`.site-nav`)

Four beveled tabs, in this order: **Front page** (`./`), **Library** (`library.html`, lime when not current), **Trips** (`trip.html`), **Flights** (`flights.html`), Barlow Condensed 800 uppercase, 48px tall. The current page has `aria-current="page"` and is pressed in (night fill, sun type), never colour alone. Below 46rem the same list becomes a tab bar fixed to the bottom of the screen (icon + word, 74px tall plus the safe-area inset; the current tab is sun), and the page gets matching bottom padding. The settings button ("Units & display") collapses to its icon on phones.

### Brand (`.brand`, `.brand__mark`, `.brand__name`)

The mark is a gate arch with a centre line, drawn as a stroke icon: `<path d="M5 20V9a7 7 0 0 1 14 0v11"/><path d="M12 13v7"/>` on a 24-unit grid, placed with `translate(4 5)` inside a 32-unit rounded square (`rx="8"`). The square is cobalt with a 2px ink edge and the glyph `--np-on-cobalt`. The wordmark is "Gatecast" set in Alfa Slab One uppercase in cobalt with a 1px sun and 2px ink offset (on the front page the masthead `h1` is the big version: GATECAST, cobalt, 3px sun and 6px ink shadows) (the HTML text stays "Gatecast"; the link's `aria-label` is "Gatecast home"). The favicon and logo are the same mark as files at the site root (`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-512.png`, drawn by `scripts/build-icons.cjs`): the cobalt square with an ink edge and the white glyph (`--np-cobalt`, `--np-ink`, `--np-on-cobalt`, day values); the touch icon is full bleed without the edge, because iOS rounds its corners.

### Location bar and welcome (`.locbar`, `.welcome`)

City search (combobox) and a "Use my location" button. The location prompt only appears after the visitor presses the button, and the welcome panel says what the location is used for first. A refusal shows a plain message and leaves search and popular cities available.

### Day rows (`.days`, `.day`)

One row per day: name, sky icon, chance of rain or snow (shown from 20%), low, a range bar positioned on the 10-day span, high.

### Radar (`.radar`)

Map with past radar frames, a play button and a time slider. The map library and tiles load only when the panel nears the screen; nothing plays automatically.

### Flight card (`.flight`, `.status`, `.progress`)

Airline and flight, route, a status pill ("In the air" with a pulsing dot, "On the ground", "Not tracked right now"), a progress track with a plane marker, and live figures. A note states what the data cannot show.

### Panel (`.panel`)

Plain titled surface for a block of content (hourly, days, radar, nearby aircraft).

## Patterns

- **Search-first page.** The form is the page. Results appear below it and the address bar updates, so every result is a shareable link and the back button works.
- **Empty state teaches.** Example trips and the visitor's recent trips sit under the form.
- **Progressive disclosure.** Verdict, then per-airport summary, then hourly strip, then raw observation and the method note.
- **Errors say what to do.** Each error names the field or the next step ("Pick a departure time from now up to 16 days out").

## Voice

Gatecast talks like a friend who knows the weather: someone who has read the forecast for you and tells you, in one breath, what is happening and what to do about it. The home headline (`headline()` in `js/boardcontent.js`) is the purest form of the voice, and every tip, question and comparison should sound like the same person wrote it.

1. **Say what is happening, then when it changes.** Lead with the weather and the moment it turns ("Dry until about 3 pm, then rain."). Then one short action. Two sentences, 6 to 14 words, never more than 18.
2. **One action, the most useful one.** Danger comes first (thunder, ice, snow, damaging gusts, extreme heat or cold), then rain gear, layers, sun, a nudge to enjoy a good day, and a calm "Nothing to plan around today." when nothing matters.
3. **Doubt in one word.** Use the chance of rain or snow to pick the phrasing: "then rain" (70% or more), "then rain likely" (50 to 69%), "a chance of rain" (30 to 49%). Never round a maybe up to a certainty, and never explain the number in the headline.
4. **Only what the data says.** No causes, fronts or systems we cannot see. If the lead does not explain the action, the action changes or the lead gains the reason ("gusts to 95 km/h").
5. **Time the way people say it.** Clock times for the next six hours ("around 3 pm"), then "this evening", "tonight", "overnight", "by morning", "tomorrow afternoon", in the place's own time zone. Insert the formatted time; never assume its format.
6. **True to the hour.** No "sunny" at night. A one- or two-hour shower is "a shower", hours of rain are "steady rain", and three or more spells in a day are "on and off".
7. **Plain words, calm tone.** No exclamation marks, emoji or jargon ("precipitation", "convective"), and no "expect". Contractions are fine ("if you're out late"). Kind, never bossy or cute: "Wait it out if you can.", not "Stay inside!".
8. **Numbers only when they matter.** The big temperature is already on screen. A number earns a place in the sentence only when it is the news: a heat peak, a feels-like in deep cold, a gust speed.
9. **Same input, same words.** Copy is deterministic. Any variety is keyed to the data or the date, never to chance, so a refresh never changes the sentence.

## Do and don't

| Do | Don't |
|---|---|
| Pair every risk colour with its icon and label | Use a coloured dot or border as the only signal |
| Write times as `09:30 CST` and add the date when the day changes | Use "+1" day markers |
| Say what a percentage refers to ("chance of rain or snow in that hour") | Show a bare "40%" |
| Add a new colour to `@theme` in `styles/main.css` | Put a hex value in a component or a page |
| Keep one primary button per view | Add a second filled button |
| Use cobalt, sun, lime, paper and ink for decoration | Use red, amber/orange or teal anywhere outside risk |
| Keep risk chips round and everything else square | Round a card, button or sticker |
| Set big headlines in Alfa Slab One and datelines in VT323 at 17px+ | Set sentences in slab or pixel type, or VT323 below 17px |
| Show the editor's note and rating only when they exist | Write a summary, a rating or a reader number that is not real |
| Give starbursts and stickers their own space | Let decoration cover a headline or the wordmark |
| Use `.glass` and `--glass-*` over the animated sky | Put glass on paper |

## Audit (15 Nov 2026)

| Check | Result |
|---|---|
| Hard-coded colours in components | 0 outside the physical objects of the Stacks and the badge edges |
| Token references | every colour, font, radius and shadow in `site.css`, `weather.css`, `front.css` |
| Pixel literals outside tokens | Hairlines (1 to 3px) and risk-bar heights (8px, 14px) only |
| Interactive targets below 44px | None |
| Colour-only signals | None found |

Priority actions: test the hourly strip with a screen reader on iOS and Android.

Foundation update (16 Nov 2026): palette, type and header changed as above; contrast for text, muted text, accent, control borders and all three risk colours re-checked on bg, surface, sunken and the chip and verdict tints in both themes (numbers in the colour tables). Muted text over tinted verdict backgrounds is above 6.3:1.
