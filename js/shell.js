// Shared by every page: storage, unit, clock and theme preferences, and the settings popover.
import { setClock } from './core.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const usDefaults = /^en-US/i.test(navigator.language || '');
// 12- or 24-hour clock, from how the visitor's locale writes times unless they chose one.
const localeClock = (() => {
  try { return new Intl.DateTimeFormat(navigator.language || undefined, { hour: 'numeric' }).resolvedOptions().hour12 ? '12' : '24'; } catch { return '24'; }
})();
export const prefs = { temp: usDefaults ? 'f' : 'c', wind: usDefaults ? 'mph' : 'kmh', clock: localeClock, ...store.get('gatecast:prefs', {}) };
if (prefs.clock !== '12' && prefs.clock !== '24') prefs.clock = localeClock;
// Every fmtTime() on the page follows the preference, set before any page code formats a time.
setClock(prefs.clock);

const SETTINGS = `
  <h2 id="settings-title">Units &amp; display</h2>
  <fieldset class="segmented"><legend>Temperature</legend>
    <label><input type="radio" name="temp" value="c"><span>°C</span></label>
    <label><input type="radio" name="temp" value="f"><span>°F</span></label></fieldset>
  <fieldset class="segmented"><legend>Wind &amp; distance</legend>
    <label><input type="radio" name="wind" value="kmh"><span>km/h</span></label>
    <label><input type="radio" name="wind" value="mph"><span>mph</span></label>
    <label><input type="radio" name="wind" value="kt"><span>knots</span></label></fieldset>
  <fieldset class="segmented"><legend>Clock</legend>
    <label><input type="radio" name="clock" value="12"><span>12-hour</span></label>
    <label><input type="radio" name="clock" value="24"><span>24-hour</span></label></fieldset>
  <fieldset class="segmented"><legend>Appearance</legend>
    <label><input type="radio" name="theme" value="system"><span>Match device</span></label>
    <label><input type="radio" name="theme" value="light"><span>Light</span></label>
    <label><input type="radio" name="theme" value="dark"><span>Dark</span></label></fieldset>`;

// Fills the #settings popover and calls onChange() when a unit or the clock changes so the page can re-render.
export function initSettings(onChange = () => {}) {
  const panel = $('#settings');
  panel.innerHTML = SETTINGS;
  const theme = (() => { try { return localStorage.getItem('color-scheme') || 'system'; } catch { return 'system'; } })();
  for (const [name, value] of Object.entries({ temp: prefs.temp, wind: prefs.wind, clock: prefs.clock, theme })) {
    const input = $(`input[name="${name}"][value="${value}"]`, panel);
    if (input) input.checked = true;
  }
  panel.addEventListener('change', (e) => {
    const { name, value } = e.target;
    if (name === 'theme') {
      try { value === 'system' ? localStorage.removeItem('color-scheme') : localStorage.setItem('color-scheme', value); } catch {}
      $('meta[name="color-scheme"]').content = value === 'system' ? 'light dark' : value;
    } else {
      prefs[name] = value;
      if (name === 'clock') setClock(value);
      store.set('gatecast:prefs', prefs);
      onChange();
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key !== 'color-scheme') return;
    $('meta[name="color-scheme"]').content = e.newValue ?? 'light dark';
    const input = $(`input[name="theme"][value="${e.newValue ?? 'system'}"]`, panel);
    if (input) input.checked = true;
  });
}
