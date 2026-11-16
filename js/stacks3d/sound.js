// The Stacks: library sounds, synthesised with the Web Audio API (no audio files). Nothing plays until the
// visitor has interacted with the page, and a visible toggle turns it off (remembered on this device).
const KEY = 'gatecast:stacks-sound';

let ctx = null, master = null, noiseBuf = null;
let enabled = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
let unlocked = false;

export const soundOn = () => enabled;
export function setSound(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch {}
  if (!enabled && ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
  if (enabled && ctx && unlocked) ctx.resume().catch(() => {});
}

// Called from a user gesture (pointerdown / keydown): creates or resumes the audio context.
export function unlock() {
  unlocked = true;
  if (!enabled) return;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  } catch { ctx = null; }
}

const ready = () => enabled && unlocked && ctx && ctx.state === 'running';

function noise(at, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.005, freqTo = null } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, at); f.Q.value = q;
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(at, Math.random() * 0.5); src.stop(at + dur + 0.05);
}
function tone(at, dur, { freq = 120, freqTo = null, type = 'sine', gain = 0.4, attack = 0.004 } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, at);
  if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.05);
}

// A book sliding against its neighbours: a soft, rough wooden scrape. `amount` 0..1 scales its length.
export function slide(amount = 1) {
  if (!ready()) return;
  const t = ctx.currentTime, d = 0.18 + 0.3 * amount;
  noise(t, d, { type: 'bandpass', freq: 700, freqTo: 1500, q: 0.8, gain: 0.16, attack: 0.04 });
  noise(t + 0.02, d * 0.8, { type: 'lowpass', freq: 380, q: 0.5, gain: 0.12, attack: 0.05 });
}
// Pages and a cover moving: a few short paper rustles.
export function rustle() {
  if (!ready()) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 4; i++) noise(t + i * 0.06 + Math.random() * 0.03, 0.09 + Math.random() * 0.08, { type: 'highpass', freq: 2500 + Math.random() * 2500, q: 0.7, gain: 0.07 + Math.random() * 0.05, attack: 0.01 });
}
// The rubber stamp: a heavy thud, the wooden handle's click and the rubber lifting off.
export function stampThud() {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(t, 0.22, { freq: 95, freqTo: 42, gain: 0.7, attack: 0.002 });
  noise(t, 0.06, { type: 'lowpass', freq: 900, q: 0.7, gain: 0.5, attack: 0.001 });
  noise(t + 0.012, 0.03, { type: 'bandpass', freq: 3200, q: 3, gain: 0.25, attack: 0.001 });
  noise(t + 0.24, 0.05, { type: 'highpass', freq: 3000, q: 0.5, gain: 0.05, attack: 0.01 });
}
// A book settling back on the shelf: a quiet wooden tock.
export function tock() {
  if (!ready()) return;
  const t = ctx.currentTime;
  tone(t, 0.09, { freq: 210, freqTo: 150, type: 'triangle', gain: 0.25, attack: 0.002 });
  noise(t, 0.04, { type: 'bandpass', freq: 1100, q: 2.5, gain: 0.18, attack: 0.001 });
}
