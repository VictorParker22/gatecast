# Gatecast design system

The visual language and components of the Gatecast site. Tokens live in `styles/tokens.css`; components in `styles/app.css` reference only semantic tokens.

The direction is "a departure board for weather" (`docs/redesign.md`): the interface is monochrome (ink, concrete and paper), colour only ever means risk, and codes, times and big numbers are set like airport signage. The foundation below is shipped; page layouts are being rebuilt on top of it.

## Principles

1. **Verdict first, evidence second.** Every screen answers "will weather disrupt my trip?" in one sentence before showing any numbers.
2. **Never colour alone.** A risk level is always a word, a shape and a colour together.
3. **Local time, always labelled.** Each airport shows its own clock with the zone, and a written date when the day changes.
4. **Plain words.** No METAR, IFR or ATC terms in the main view. Raw data sits one tap deeper.
5. **Tokens only.** Components never contain a colour value; they take it from a semantic token.
6. **Colour only means risk.** Everything else is ink, concrete, paper and greys. Teal, amber and rose appear only for Low, Elevated and High, so a colour on screen is always news about the weather on the trip. Links, buttons, focus rings, charts and the current-page mark are ink (white in dark).
7. **Calm collapses, risk expands.** When nothing threatens the trip, say so in one quiet line (grey text with the tick shape, `--color-calm`) and get out of the way. When something does, that stop or banner opens up with a tint, the reason, the hours that matter and what to do.

## Tokens

### Colour

Light is concrete and paper with ink type; dark is near-black with white type. Contrast is measured against both `--color-bg` and `--color-surface`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#ECEBE6` | `#07090D` | Page background (concrete / night) |
| `--color-surface` | `#FFFFFF` | `#111418` | Cards, form, popover |
| `--color-surface-sunken` | `#E0DFD9` | `#1B1F25` | Wells, hover rows, empty bar track |
| `--color-border` | `#D6D4CC` | `#2A2F37` | Hairlines |
| `--color-text` | `#111418` | `#E9EDF5` | Body text (15.5:1 on bg / 18.5:1 on surface light; 17.0:1 / 15.7:1 dark) |
| `--color-text-muted` | `#4F545B` | `#A9B0BA` | Labels, captions (6.4:1 / 7.6:1 light; 9.1:1 / 8.5:1 dark) |
| `--color-calm` | = text-muted | = text-muted | Calm / low states rendered quietly (grey text plus the tick shape) |
| `--color-accent` | `#111418` (ink) | `#FFFFFF` | Primary button, links, focus ring, current nav mark, charts. Never a hue |
| `--color-on-accent` | `#FFFFFF` | `#07090D` | Text on the accent |
| `--color-control-border` | `#7E838A` | `#6E757F` | Non-text control edges (3.2:1 / 3.8:1 light; 4.3:1 / 4.0:1 dark) |
| `--color-live` | = text | = text | "In the air" status; monochrome, the pulsing dot carries the meaning |
| `--color-map-land` / `--color-map-sea` | `#D6D4CC` / `#E0DFD9` | `#2F343C` / `#0C0F14` | Inline route map |
| `--risk-low` | `#0B6B5F` | `#5FD3C0` | Low risk (teal, tick in circle) |
| `--risk-elevated` | `#8F4E00` | `#F2B450` | Elevated risk (amber, triangle) |
| `--risk-high` | `#A81C48` | `#FF8AA8` | High risk (rose, octagon) |

Risk contrast (text-size use, all at least 4.5:1):

| Level | Light on bg / surface / chip tint | Dark on bg / surface / chip tint |
|---|---|---|
| Low | 5.4 / 6.4 / 5.2 | 11.0 / 10.2 / 8.2 |
| Elevated | 5.4 / 6.5 / 5.2 | 10.8 / 10.0 / 8.1 |
| High | 6.0 / 7.2 / 5.8 | 9.0 / 8.3 / 6.8 |

Body text on the 11% verdict tint stays above 15:1 (light) and 13:1 (dark); muted text on it above 6.3:1 and 7.0:1.

Risk tints are derived, not stored: `color-mix(in oklab, var(--risk) 14%, var(--color-surface))` for fills and 40-45% for borders. A component sets `--risk` once from its level modifier (`.chip--high`, `.stop--high`, `.verdict--high`, `.hour--high`); the `--calm` modifier (`.chip--calm`, `.stop--calm`, `.verdict--calm`) sets it to `--color-calm`.

Teal, amber and rose were chosen over green, yellow and red so the three levels stay apart for people with red-green colour blindness.

#### Sky, glass and fixed surfaces

| Token | Value | Use |
|---|---|---|
| `--sky-day` … `--sky-storm` | `#1D5FD6`, `#141B3A`, `#5A6B82`, `#33415F`, `#4D6585`, `#272C42` | Flat fallback colour behind the animated sky, one per condition. Not UI colour |
| `--color-on-sky` / `--color-on-sky-muted` | `#FFFFFF` / `#E6EEFF` | Text on the sky |
| `--glass-bg` | `rgba(9,11,16,0.42)` | Frosted panel fill, only over the animated sky (white text on it is about 10.9:1 over `--sky-day`) |
| `--glass-border` | `rgba(255,255,255,0.16)` | Frosted panel edge |
| `--glass-blur` | `22px` | `backdrop-filter: blur()` radius for glass |
| `--color-sun` / `--color-on-sun` | `#FFFFFF` / `#111418` | Legacy name: the white emphasis on the sky (`.btn--sun`, sky focus ring, current nav mark on the sky). No longer yellow |
| `--color-ink-surface` | `#111418` / `#252A31` | Ink emphasis panel ("Get ready", primary sheet action) |
| `--color-on-ink` / `--color-on-ink-muted` | `#FFFFFF` / `#C3C8CF` | Text on the ink panel |

The raw palette (`--paper-*`, `--ink-*`, `--teal-*`, `--amber-*`, `--rose-*`) is for tokens.css only. The old `--cobalt-*` values are gone; the radar "you are here" marker reads `--ink-900`.

### Typography

Two faces, both self-hosted from `vendor/fonts/` (SIL Open Font License), so no visitor data goes to a font service:

- **Inter** (`--font-sans`, variable 100-900) for sentences: body, headings that are sentences, labels, buttons.
- **Barlow Condensed** (`--font-display`, static 600 and 700, latin and latin-ext) for signage: airport codes, flight numbers, times, temperatures and other big numbers, the verdict headline, risk chips, status pills, the nav and the wordmark. Often uppercase with `--tracking-caps` (0.06em). Weights other than 600/700 snap to the nearest of those two.

Headings (`h1`-`h3`) default to Inter 700; only the verdict and flight headlines are set in Barlow. Tabular numerals are on everywhere so times and temperatures line up. `--font-mono` remains only for raw METAR text.

| Token | Size | Use |
|---|---|---|
| `--text-2xl` | 2 to 3.5rem, fluid | Page headline |
| `--text-xl` | 1.5 to 2.125rem, fluid | Section headline |
| `--text-lg` | 1.25rem | Card headings |
| `--text-md` | 1rem | Body |
| `--text-sm` | 0.875rem | Labels, secondary text |
| `--text-xs` | 0.75rem | Captions, hourly strip |
| `--tracking-caps` | 0.06em | Letter-spacing for uppercase signage |

Utilities in `app.css`: `.signage` (Barlow 700, uppercase, tracked), `.num` (Barlow 600, tabular), `.code` (Barlow 700, airport and flight codes), `.glass` (frosted panel; only inside `.sky`).

### Spacing, shape, motion

- Spacing: 4px base, `--space-1` (4px) to `--space-7` (48px).
- Radius: `--radius-sm` 6px (inputs, focus ring), `--radius-md` 16px (cards, panels, popover), `--radius-lg` 20px (form, verdict, flight card, board tiles), `--radius-xl` 28px (sheet, shelf), `--radius-pill` 999px (buttons, chips, segmented options, pills).
- Elevation: `--shadow-1` (resting card), `--shadow-2` (popover, suggestion list).
- Motion: `--duration-fast` 120ms for hover and press, `--duration-base` 240ms for results entering. All motion is removed under `prefers-reduced-motion`.
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

### Buttons (`.btn`)

All pill-shaped, at least 44px tall. `--primary` (one per view: "Check my trip"; ink with white text in light, white with ink text in dark), `--ghost` (secondary, bordered), `--text` (inline action, underlined ink), `--icon` (44px square, needs `aria-label`), `--glass` (white text on frosted glass, only over the sky), `--sun` (white with ink text, the primary action on the sky). `.pill` is used for example and recent trips; `.pill.is-current` is filled ink.

### Settings popover (`.settings`, `.segmented`)

Native `popover` opened from the header. Three segmented radio groups: temperature, wind and distance, appearance. Appearance defaults to "Match device"; the override is kept out of the main interface because most visitors never need it.

### Route map (`.map`)

Inline SVG, no tiles or map library. Land outline from Natural Earth, great-circle arcs, one marker per airport whose shape and colour follow its risk level (circle, triangle, diamond). The same chips are repeated in the caption so nothing depends on reading the map.

### Live rows (`.live`)

Current observation ("Right now: …") with the raw METAR behind a disclosure, active National Weather Service alerts, and FAA delay programmes. Alerts use the elevated tint with its icon.

### Sky header (`.sky`, `.hero-wx`)

The top of the weather page is one flat colour chosen by the current conditions (`--sky-day`, `--sky-night`, `--sky-cloud`, `--sky-rain`, `--sky-snow`, `--sky-storm`), each dark enough for white text. It holds the navigation, the location bar, the place and time, a very large temperature, one headline sentence that says what the weather is doing and when it changes, and the four parts of the day ahead. It is the only part of the page the visitor cannot move.

### Animated sky (`js/sky.js`, `js/sky/shaders.js`, `styles/sky.css`)

A WebGL canvas behind the sky header draws the weather: a sun glow that follows the time between sunrise and sunset with drifting high cloud by day, stars and a moon at night, layered overcast, rain whose density follows the forecast and whose slant follows the wind, drifting snow, and storm cloud with rare, soft brightening.

- The shader caps brightness so white text keeps at least 4.5:1 contrast everywhere.
- If WebGL is missing or fails, the canvas stays invisible and the flat sky colour shows.
- With reduced motion it draws one still frame per change, with no lightning.
- It renders at no more than 1.5 device pixels per CSS pixel and pauses when the tab is hidden or the sky is scrolled out of view.

### Motion (`styles/motion.css`, `js/motion.js`)

All motion lives in its own layer so it can be tuned or removed without touching layout.

| Moment | What moves |
|---|---|
| First forecast | Place, temperature (counts up), sentence, day parts, then the board arrive in sequence in under about 700ms. It does not replay on unit changes. |
| Dragging a box | A copy lifts under the pointer with a slight tilt and shadow, its place becomes a dashed slot, the others glide aside, and it settles on release. Over the shelf it shrinks into the new shortcut. |
| Resizing a box | The box grows or shrinks while its contents cross-fade. |
| Options panel | The glass rises, scales and sharpens; on phones it comes up from the bottom. Exits are faster than entrances. |
| Quiz answer | The right option pops; a wrong pick shakes once. Ticks and crosses still carry the meaning. |

Everything becomes an instant change under `prefers-reduced-motion`, and only transform, opacity and (sparingly) filter are animated.

### Board and boxes (`.board`, `.tile`)

Everything below the sky is a box on a six-column grid. Each box has three sizes: small (2 columns), medium (3) and large (6); two-column and one-column layouts apply on tablets and phones. A bigger box shows more: more hours, more days, more stats, more cities, more checklist items.

| Control | What it does |
|---|---|
| Grip (six dots) | Drag to reorder with mouse, pen or touch. Dropping on the shelf adds the box to it. Pressing it opens the options panel. |
| Resize (arrows) | Cycles small, medium, large. |
| Options (three dots) | Opens the options panel. |

Changes animate with view transitions, which are switched off under `prefers-reduced-motion`. Every move is announced to screen readers ("10 days moved to position 3 of 8"). The arrangement is saved on the device.

Two boxes use fixed emphasis surfaces: the quick question (`--color-sun`, now white with ink text, so it stands out in dark and sits flush in light) and "Get ready" (`--color-ink-surface`).

### Options panel (`.sheet`)

A native modal `<dialog>` styled as frosted glass: a translucent surface with a strong backdrop blur over a lightly blurred page. Actions: keep on shelf, bigger, smaller, move earlier, move later, copy a link, hide. Move earlier and later are the keyboard and screen-reader route to reordering. Unavailable actions are disabled, not hidden.

### Shelf (`.shelf`)

A compact frosted pill pinned to the bottom of the screen holding shortcuts to the boxes the visitor has kept. Selecting one scrolls to that box and outlines it briefly.

### Pedestal (`.pedestal`)

A quiet line inside the sky, under the forecast, that introduces the board: a one-line explanation, the visitor's day streak, shelf count and questions answered, and the reset and show-hidden controls. It is deliberately not a card, so it does not compete with the forecast.

### Quick question (`.quiz__*`)

One question a day made from the forecast on the page, answered with one tap. The correct option gets a tick and inverted colours; a wrong pick is struck through with a cross, so the result never depends on colour alone.

### Site navigation (`.site-nav`)

Three links, in this order: **Today** (`./`), **Trips** (`trip.html`), **Flights** (`flights.html`), set in Barlow Condensed uppercase. The current page is marked with `aria-current="page"` and shown with a bolder label plus a 3px ink underline (white on the sky), never colour alone. On narrow screens the links move to their own row and the settings button ("Units & display", a native popover) collapses to its icon.

### Brand (`.brand`, `.brand__mark`, `.brand__name`)

The mark is a gate arch with a centre line, drawn as a stroke icon: `<path d="M5 20V9a7 7 0 0 1 14 0v11"/><path d="M12 13v7"/>` on a 24-unit grid, placed with `translate(4 5)` inside a 32-unit rounded square (`rx="8"`). On paper pages the square is `--color-accent` (ink in light, white in dark) and the glyph `--color-on-accent`; over the sky the square is transparent and the glyph white. The wordmark is "Gatecast" set in Barlow Condensed 700 uppercase with 0.08em tracking (the HTML text stays "Gatecast"; the link's `aria-label` is "Gatecast home"). The favicon is the same mark: an `#111418` square with a white glyph.

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
| Add a new colour as a raw value, then a semantic token | Put a hex value in `app.css` |
| Keep one primary button per view | Add a second filled button |
| Use ink (`--color-accent`) for links, actions, charts and "you are here" | Use a hue for anything that is not a risk level |
| Set codes, times and big numbers in `--font-display` | Set sentences in Barlow Condensed (the verdict headline is the one exception) |
| Use `.glass` and `--glass-*` over the animated sky | Put glass on paper pages |

## Audit (15 Nov 2026)

| Check | Result |
|---|---|
| Hard-coded colours in `app.css` | 0 |
| Token references in `app.css` | 155 |
| Pixel literals outside tokens | Hairlines (1 to 3px) and risk-bar heights (8px, 14px) only |
| Interactive targets below 44px | None |
| Colour-only signals | None found |

Priority actions: test the hourly strip with a screen reader on iOS and Android.

Foundation update (16 Nov 2026): palette, type and header changed as above; contrast for text, muted text, accent, control borders and all three risk colours re-checked on bg, surface, sunken and the chip and verdict tints in both themes (numbers in the colour tables). Muted text over tinted verdict backgrounds is above 6.3:1.
