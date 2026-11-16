## Summary

<!-- What does this change do, and why? One or two sentences. -->

## Changes

<!-- The main changes, as a short list. -->

-

## How tested

<!-- Commands you ran and what you checked by hand, with browser and device. -->

- [ ] `npm test`
- [ ] `node scripts/build-data.cjs` (if the build, data or page list changed)
- [ ] Checked by hand with `node server.js` at http://localhost:4173

## Screenshots

<!-- For UI changes: before and after, light and dark, phone and desktop where it matters. Delete this section otherwise. -->

## Checklist

- [ ] Tests pass (`npm test`), and new pure logic in `js/core.js`, `js/boardcontent.js` or `js/sky/governor.js` has tests
- [ ] Accessibility checked: keyboard, focus order, screen-reader text, 44px tap targets, and `prefers-reduced-motion`
- [ ] Risk is never shown by colour alone (word, shape and colour together)
- [ ] Styles use semantic tokens from `styles/tokens.css`, no raw colour values in components
- [ ] Copy follows the voice in `docs/design-system.md` (plain words, no jargon, no exclamation marks)
- [ ] No new secrets, keys or credentials in the code, config or history
- [ ] README and `docs/` updated if behaviour, data sources or limits changed
