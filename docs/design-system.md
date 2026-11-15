# Gatecast design system

The visual language and components of the Gatecast site. Tokens live in `styles/tokens.css`; components in `styles/app.css` reference only semantic tokens.

## Principles

1. **Verdict first, evidence second.** Every screen answers "will weather disrupt my trip?" in one sentence before showing any numbers.
2. **Never colour alone.** A risk level is always a word, a shape and a colour together.
3. **Local time, always labelled.** Each airport shows its own clock with the zone, and a written date when the day changes.
4. **Plain words.** No METAR, IFR or ATC terms in the main view. Raw data sits one tap deeper.
5. **Tokens only.** Components never contain a colour value; they take it from a semantic token.

## Tokens

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#f4f1ea` | `#0d131b` | Page background |
| `--color-surface` | `#fffdf8` | `#151d28` | Cards, form, popover |
| `--color-surface-sunken` | `#e9e4d8` | `#1c2634` | Wells, hover rows, empty bar track |
| `--color-border` | `#d6cfbf` | `#2a3646` | Hairlines |
| `--color-text` | `#17202b` | `#e9edf2` | Body text |
| `--color-text-muted` | `#5b6675` | `#9aa6b5` | Labels, captions |
| `--color-accent` | `#1f4fd8` | `#8fb0ff` | Primary action, links, airport codes, "you are here" shading |
| `--risk-low` | `#0b6b5f` | `#5fd3c0` | Low risk (teal, tick in circle) |
| `--risk-elevated` | `#8f4e00` | `#f2b450` | Elevated risk (amber, triangle) |
| `--risk-high` | `#a81c48` | `#ff8aa8` | High risk (rose, octagon) |

Risk tints are derived, not stored: `color-mix(in oklab, var(--risk) 14%, var(--color-surface))` for fills and 40-45% for borders. A component sets `--risk` once from its level modifier (`.chip--high`, `.stop--high`, `.verdict--high`, `.hour--high`).

Teal, amber and rose were chosen over green, yellow and red so the three levels stay apart for people with red-green colour blindness.

### Typography

System font stack (`--font-sans`) with tabular numerals everywhere, so times and temperatures line up. `--font-mono` is reserved for airport codes and route strings.

| Token | Size | Use |
|---|---|---|
| `--text-2xl` | 2 to 3.5rem, fluid | Page headline |
| `--text-xl` | 1.5 to 2.125rem, fluid | Verdict headline |
| `--text-lg` | 1.25rem | Section and card headings, times |
| `--text-md` | 1rem | Body |
| `--text-sm` | 0.875rem | Labels, secondary text |
| `--text-xs` | 0.75rem | Captions, hourly strip |

### Spacing, shape, motion

- Spacing: 4px base, `--space-1` (4px) to `--space-7` (48px).
- Radius: `--radius-sm` 6px (inputs), `--radius-md` 12px (cards), `--radius-lg` 20px (form, verdict), `--radius-pill`.
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

Not interactive. The icon is `aria-hidden`; the text carries the meaning.

### Verdict banner (`.verdict`)

Route and date eyebrow, one-sentence headline, one-sentence reason, forecast-confidence note, "Copy link" action. Variants follow the risk levels plus `--loading` and `--unknown` (errors, out-of-range dates). The headline receives focus after results load so screen-reader users hear the answer first.

### Stop card (`.stop`)

One per airport, in travel order. Contains role (Departure, Connection with layover length, Arrival), airport name, local land and take-off times, the weather at the relevant hour, a one-line reason, the hourly strip, and live rows. A 4px top border carries the risk colour; the chip carries the word.

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

`--primary` (one per view: "Check my trip"), `--ghost` (secondary, bordered), `--text` (inline action), `--icon` (44px square, needs `aria-label`). `.pill` is used for example and recent trips.

### Settings popover (`.settings`, `.segmented`)

Native `popover` opened from the header. Three segmented radio groups: temperature, wind and distance, appearance. Appearance defaults to "Match device"; the override is kept out of the main interface because most visitors never need it.

### Route map (`.map`)

Inline SVG, no tiles or map library. Land outline from Natural Earth, great-circle arcs, one marker per airport whose shape and colour follow its risk level (circle, triangle, diamond). The same chips are repeated in the caption so nothing depends on reading the map.

### Live rows (`.live`)

Current observation ("Right now: …") with the raw METAR behind a disclosure, active National Weather Service alerts, and FAA delay programmes. Alerts use the elevated tint with its icon.

## Patterns

- **Search-first page.** The form is the page. Results appear below it and the address bar updates, so every result is a shareable link and the back button works.
- **Empty state teaches.** Example trips and the visitor's recent trips sit under the form.
- **Progressive disclosure.** Verdict, then per-airport summary, then hourly strip, then raw observation and the method note.
- **Errors say what to do.** Each error names the field or the next step ("Pick a departure time from now up to 16 days out").

## Do and don't

| Do | Don't |
|---|---|
| Pair every risk colour with its icon and label | Use a coloured dot or border as the only signal |
| Write times as `09:30 CST` and add the date when the day changes | Use "+1" day markers |
| Say what a percentage refers to ("chance of rain or snow in that hour") | Show a bare "40%" |
| Add a new colour as a raw value, then a semantic token | Put a hex value in `app.css` |
| Keep one primary button per view | Add a second filled button |

## Audit (15 Nov 2026)

| Check | Result |
|---|---|
| Hard-coded colours in `app.css` | 0 |
| Token references in `app.css` | 155 |
| Pixel literals outside tokens | Hairlines (1 to 3px) and risk-bar heights (8px, 14px) only |
| Interactive targets below 44px | None |
| Colour-only signals | None found |

Priority actions: run a contrast check on muted text over tinted verdict backgrounds; test the hourly strip with a screen reader on iOS and Android.
