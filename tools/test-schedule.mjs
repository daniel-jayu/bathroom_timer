// Verifies that index.html pre-schedules alert audio on the audio thread at
// the correct times (this is what makes the trumpet play with the screen off).
// Runs the real inline script from index.html inside a stubbed DOM/Web Audio env.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const html = readFileSync('index.html', 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

const scheduled = [];
let audioTime = 0;

function makeParam() {
  return {
    value: 0,
    setValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
  };
}

function makeNode(extra = {}) {
  const base = {
    connect() {}, disconnect() {},
    start() {}, stop() {},
    gain: makeParam(), frequency: makeParam(), detune: makeParam(),
    Q: makeParam(), threshold: makeParam(), knee: makeParam(),
    ratio: makeParam(), attack: makeParam(), release: makeParam(),
  };
  // Must copy descriptors: spreading would invoke getters and drop setters,
  // so assignments like `source.loop = true` would go unrecorded.
  return Object.defineProperties(base, Object.getOwnPropertyDescriptors(extra));
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this.destination = makeNode();
  }
  get currentTime() { return audioTime; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createOscillator() { return makeNode(); }
  createGain() { return makeNode(); }
  createBiquadFilter() { return makeNode(); }
  createDynamicsCompressor() { return makeNode(); }
  createBuffer(ch, len, sr) { return { duration: len / sr, length: len, sampleRate: sr }; }
  createBufferSource() {
    const record = { startedAt: null, stoppedAt: null, loop: false };
    scheduled.push(record);
    return makeNode({
      set buffer(b) { record.buffer = b; },
      get buffer() { return record.buffer; },
      set loop(v) { record.loop = v; },
      get loop() { return record.loop; },
      loopStart: 0, loopEnd: 0,
      start(t = 0) { record.startedAt = t; },
      stop(t) { record.stoppedAt = t; },
    });
  }
}

class FakeOfflineAudioContext {
  constructor(channels, length, sampleRate) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.destination = makeNode();
  }
  createOscillator() { return makeNode(); }
  createGain() { return makeNode(); }
  createBiquadFilter() { return makeNode(); }
  createDynamicsCompressor() { return makeNode(); }
  startRendering() {
    return Promise.resolve({ duration: this.length / this.sampleRate, length: this.length });
  }
}

const elements = new Map();
function el(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id, value: 0, textContent: '', handlers: {},
      style: { setProperty() {}, display: '' },
      classList: { add() {}, remove() {}, contains: () => false },
      dataset: {},
      setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; },
    });
  }
  return elements.get(id);
}

const store = new Map();
const sandbox = {
  console,
  setInterval, clearInterval, setTimeout, clearTimeout,
  Promise, Math, Date, JSON, Number, String, Object, Array, Error,
  ArrayBuffer, DataView, Uint8Array, Blob, URLSearchParams,
  AudioContext: FakeAudioContext,
  OfflineAudioContext: FakeOfflineAudioContext,
  Audio: class { constructor() {} play() { return Promise.resolve(); } pause() {} setAttribute() {} },
  URL: { createObjectURL: () => 'blob:fake' },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  },
  navigator: { vibrate() {}, userAgent: 'node', platform: 'test', maxTouchPoints: 0 },
  location: { search: '', protocol: 'http:' },
  document: {
    getElementById: el,
    querySelectorAll: () => [],
    addEventListener() {},
    title: '',
    visibilityState: 'visible',
  },
};
sandbox.window = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.window.matchMedia = () => ({ matches: false });
sandbox.globalThis = sandbox;

const ctx = createContext(sandbox);
runInContext(script, ctx);

// ---- Drive the app: 20 minute timer, 10 minute completion-sound interval ----
el('hours').value = 0;
el('minutes').value = 20;
el('seconds').value = 0;
el('intervalHours').value = 0;
el('intervalMinutes').value = 10;
el('intervalSeconds').value = 0;

el('startPause').handlers.click();          // press Start
await new Promise(r => setTimeout(r, 50));  // let the phrase render + schedule

const phrase = 1.4;
const rings = scheduled.filter(s => s.startedAt !== null && s.startedAt > 1);

console.log('Scheduled alert sources:', rings.length);
for (const r of rings) {
  const repeats = r.stoppedAt === null ? Infinity : Math.round((r.stoppedAt - r.startedAt) / phrase);
  console.log(
    `  at t=${r.startedAt.toFixed(1)}s (${(r.startedAt / 60).toFixed(1)} min)  ` +
    `loop=${r.loop}  repeats=${repeats === Infinity ? 'forever' : repeats}`
  );
}

const checks = [];
const intermediate = rings.find(r => Math.abs(r.startedAt - 600) < 0.6);
const final = rings.find(r => Math.abs(r.startedAt - 1200) < 0.6);

checks.push(['exactly 2 alerts queued', rings.length === 2]);
checks.push(['intermediate alert queued at 10 min', !!intermediate]);
checks.push(['intermediate repeats 6 times then stops',
  !!intermediate && intermediate.stoppedAt !== null &&
  Math.round((intermediate.stoppedAt - intermediate.startedAt) / phrase) === 6]);
checks.push(['final alert queued at 20 min', !!final]);
checks.push(['final alert loops forever (until Reset)',
  !!final && final.loop === true && final.stoppedAt === null]);

// Reset must cancel everything queued on the audio thread.
el('reset').handlers.click();
const stillPending = scheduled.filter(s => s.startedAt !== null && s.startedAt > 1 && s.stoppedAt === null);
checks.push(['Reset cancels all queued audio', stillPending.length === 0]);

console.log('');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
