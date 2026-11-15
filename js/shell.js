// Shared by every page: storage, unit and theme preferences, and the settings popover.
export const $ = (sel, root = document) => root.querySelector(sel);
export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const usDefaults = /^en-US/i.test(navigator.language || '');
export const prefs = { temp: usDefaults ? 'f' : 'c', wind: usDefaults ? 'mph' : 'kmh', ...store.get('gatecast:prefs', {}) };

const SETTINGS = `
  <h2 id="settings-title">Units &amp; display</h2>
  <fieldset class="segmented"><legend>Temperature</legend>
    <label><input type="radio" name="temp" value="c"><span>°C</span></label>
    <label><input type="radio" name="temp" value="f"><span>°F</span></label></fieldset>
  <fieldset class="segmented"><legend>Wind &amp; distance</legend>
    <label><input type="radio" name="wind" value="kmh"><span>km/h</span></label>
    <label><input type="radio" name="wind" value="mph"><span>mph</span></label>
    <label><input type="radio" name="wind" value="kt"><span>knots</span></label></fieldset>
  <fieldset class="segmented"><legend>Appearance</legend>
    <label><input type="radio" name="theme" value="system"><span>Match device</span></label>
    <label><input type="radio" name="theme" value="light"><span>Light</span></label>
    <label><input type="radio" name="theme" value="dark"><span>Dark</span></label></fieldset>`;

// Fills the #settings popover and calls onChange() when a unit changes so the page can re-render.
export function initSettings(onChange = () => {}) {
  const panel = $('#settings');
  panel.innerHTML = SETTINGS;
  const theme = (() => { try { return localStorage.getItem('color-scheme') || 'system'; } catch { return 'system'; } })();
  for (const [name, value] of Object.entries({ temp: prefs.temp, wind: prefs.wind, theme })) {
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
