// synth.js
// Built-in sounds generated with the Web Audio API, so counters have distinct
// cues without shipping audio files. Each voice schedules its nodes from time
// `t` into `out` (a gain node carrying the slot volume) and returns its length.

let context = null;
let poweredOff = false;
let noise = null;

/** The page's one AudioContext (also carries the amplifier keep-alive tone), resumed if suspended. */
export function getAudioContext({ allowPowerOff = false } = {}) {
  if (poweredOff && !allowPowerOff) throw new Error('Audio is powered off');
  if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

/** Permanently stop this page's synth, traffic and hum context. */
export function shutdownAudioContext() {
  poweredOff = true;
  const previous = context;
  context = null;
  noise = null;
  if (previous && previous.state !== 'closed') void previous.close().catch(() => {});
}

function noiseBuffer(ac) {
  if (noise) return noise;
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

// Gain envelope: silent -> peak after `attack` s -> near silent after `decay` s.
function envelope(ac, out, t, { attack = 0.005, peak = 1, decay = 0.3 } = {}) {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  gain.connect(out);
  return gain;
}

function tone(ac, out, t, { type = 'sine', from, to = from, glide = 0.1, ...env }) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + glide);
  const length = (env.attack ?? 0.005) + (env.decay ?? 0.3);
  osc.connect(envelope(ac, out, t, env));
  osc.start(t);
  osc.stop(t + length + 0.05);
  return osc;
}

function noiseBurst(ac, out, t, { length = 0.2, filter = 'bandpass', freq = 1000, to, q = 1, ...env }) {
  const source = ac.createBufferSource();
  source.buffer = noiseBuffer(ac);
  const biquad = ac.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.setValueAtTime(freq, t);
  if (to) biquad.frequency.exponentialRampToValueAtTime(to, t + length);
  biquad.Q.value = q;
  source.connect(biquad);
  const gain = envelope(ac, out, t, { decay: length, ...env });
  biquad.connect(gain);
  source.start(t, Math.random() * 0.5);
  source.stop(t + length + 0.05);
  return gain;
}

const VOICES = {
  // Witness: a bright rising "eye opens" blip with a shimmer.
  eye(ac, out, t) {
    tone(ac, out, t, { from: 660, to: 1320, glide: 0.12, peak: 0.45, decay: 0.35 });
    tone(ac, out, t + 0.04, { from: 1980, to: 2640, glide: 0.2, peak: 0.12, decay: 0.4 });
    tone(ac, out, t, { from: 110, peak: 0.25, decay: 0.25 });
    return 0.5;
  },
  // Chaos: a crackling burst of static sweeping down.
  static(ac, out, t) {
    const gain = noiseBurst(ac, out, t, { length: 0.35, freq: 3200, to: 700, q: 1.4, peak: 0.6 });
    for (let s = 0.02; s < 0.35; s += 0.018) {
      gain.gain.setValueAtTime(0.0001 + Math.random() * 0.6 * (1 - s / 0.35), t + s);
    }
    return 0.4;
  },
  // Global witness: a soft, wide bell chord.
  globe(ac, out, t) {
    [523.25, 784, 1046.5].forEach((f, i) => tone(ac, out, t + i * 0.03, { from: f, peak: 0.22, attack: 0.01, decay: 1.1 }));
    return 1.2;
  },
  // Captured: mechanical containment lock - click, clunk, latch.
  lock(ac, out, t) {
    noiseBurst(ac, out, t, { length: 0.02, filter: 'highpass', freq: 2500, peak: 0.7 });
    tone(ac, out, t + 0.01, { from: 160, to: 60, glide: 0.12, peak: 0.9, decay: 0.2 });
    noiseBurst(ac, out, t + 0.1, { length: 0.03, filter: 'highpass', freq: 3500, peak: 0.6 });
    tone(ac, out, t + 0.1, { type: 'square', from: 1400, peak: 0.06, decay: 0.25 });
    return 0.4;
  },
  // Killed: heavy low thud with an impact crack.
  thud(ac, out, t) {
    const shaper = ac.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); }
    shaper.curve = curve;
    shaper.connect(out);
    tone(ac, shaper, t, { from: 120, to: 35, glide: 0.4, peak: 1, decay: 0.55 });
    noiseBurst(ac, out, t, { length: 0.05, filter: 'lowpass', freq: 600, peak: 0.8 });
    return 0.6;
  },
  // Escaped: two rising siren whoops.
  alarm(ac, out, t) {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    filter.connect(out);
    [0, 0.38].forEach(offset => {
      tone(ac, filter, t + offset, { type: 'sawtooth', from: 480, to: 1100, glide: 0.3, peak: 0.3, attack: 0.02, decay: 0.34 });
    });
    return 0.8;
  },
  // Any counter going down: a small falling tick.
  tick(ac, out, t) {
    tone(ac, out, t, { type: 'triangle', from: 420, to: 290, glide: 0.06, peak: 0.35, decay: 0.08 });
    return 0.12;
  },
  // Critical glitch: stuttering digital garbage.
  glitch(ac, out, t) {
    const osc = ac.createOscillator();
    osc.type = 'square';
    const gain = ac.createGain();
    for (let s = 0; s < 0.18; s += 0.02) {
      osc.frequency.setValueAtTime(80 + Math.random() * 1900, t + s);
      gain.gain.setValueAtTime(Math.random() < 0.7 ? 0.18 : 0, t + s);
    }
    gain.gain.setValueAtTime(0, t + 0.18);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
    noiseBurst(ac, out, t, { length: 0.15, filter: 'highpass', freq: 4000, peak: 0.25 });
    return 0.2;
  },
  // Alternatives for merit-like cues.
  chime(ac, out, t) {
    [660, 880, 1320].forEach((f, i) => tone(ac, out, t + i * 0.07, { from: f, peak: 0.3, decay: 0.45 }));
    return 0.7;
  },
  fanfare(ac, out, t) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(ac, out, t + i * 0.09, { type: 'triangle', from: f, peak: 0.28, attack: 0.01, decay: i === 3 ? 0.7 : 0.18 }));
    return 1;
  },
  // Alternatives for demerit-like cues.
  buzzer(ac, out, t) {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.connect(out);
    tone(ac, filter, t, { type: 'square', from: 110, peak: 0.35, attack: 0.01, decay: 0.4 });
    tone(ac, filter, t, { type: 'square', from: 116.5, peak: 0.35, attack: 0.01, decay: 0.4 });
    return 0.45;
  },
  descend(ac, out, t) {
    [440, 370, 311, 262].forEach((f, i) => tone(ac, out, t + i * 0.1, { type: 'triangle', from: f, peak: 0.3, decay: 0.2 }));
    return 0.6;
  },
  // Retina scanner: a soft electronic sweep with a fast flutter.
  scan(ac, out, t) {
    const flutter = ac.createGain();
    for (let i = 0; i < 20; i++) flutter.gain.setValueAtTime(i % 2 ? 0.5 : 1, t + i * 0.04);
    flutter.connect(out);
    tone(ac, flutter, t, { from: 330, to: 990, glide: 0.75, peak: 0.18, attack: 0.06, decay: 0.7 });
    tone(ac, flutter, t, { type: 'triangle', from: 1320, to: 1980, glide: 0.75, peak: 0.04, attack: 0.06, decay: 0.7 });
    return 0.8;
  },

  /* ---------- buttons: short, quiet, and office-flavoured ---------- */
  // A small dry click.
  click(ac, out, t) {
    noiseBurst(ac, out, t, { length: 0.012, freq: 3200, q: 2.5, peak: 0.5, attack: 0.001 });
    tone(ac, out, t, { from: 1800, to: 1200, glide: 0.02, peak: 0.12, attack: 0.001, decay: 0.03 });
    return 0.06;
  },
  // A soft round blip.
  tap(ac, out, t) {
    tone(ac, out, t, { from: 880, to: 660, glide: 0.05, peak: 0.3, attack: 0.003, decay: 0.07 });
    return 0.1;
  },
  // Something added: a quick rising pop.
  pop(ac, out, t) {
    tone(ac, out, t, { from: 320, to: 900, glide: 0.07, peak: 0.4, attack: 0.003, decay: 0.1 });
    noiseBurst(ac, out, t, { length: 0.015, filter: 'highpass', freq: 3000, peak: 0.15, attack: 0.001 });
    return 0.14;
  },
  // A toggle or tab: the two clicks of a physical switch.
  switch(ac, out, t) {
    noiseBurst(ac, out, t, { length: 0.01, freq: 2400, q: 3, peak: 0.45, attack: 0.001 });
    noiseBurst(ac, out, t + 0.045, { length: 0.012, freq: 1500, q: 3, peak: 0.35, attack: 0.001 });
    tone(ac, out, t + 0.045, { type: 'triangle', from: 520, peak: 0.1, attack: 0.002, decay: 0.05 });
    return 0.1;
  },
  // Opening something: an airy whoosh rising.
  open(ac, out, t) {
    noiseBurst(ac, out, t, { length: 0.18, freq: 500, to: 2600, q: 1.2, peak: 0.35, attack: 0.05 });
    tone(ac, out, t + 0.02, { from: 440, to: 660, glide: 0.12, peak: 0.08, attack: 0.03, decay: 0.12 });
    return 0.24;
  },
  // Closing or going back: the same whoosh falling.
  close(ac, out, t) {
    noiseBurst(ac, out, t, { length: 0.16, freq: 2400, to: 450, q: 1.2, peak: 0.3, attack: 0.03 });
    tone(ac, out, t + 0.02, { from: 660, to: 420, glide: 0.1, peak: 0.07, attack: 0.02, decay: 0.1 });
    return 0.22;
  },
  // Confirm: two short rising notes.
  confirm(ac, out, t) {
    tone(ac, out, t, { type: 'triangle', from: 784, peak: 0.25, decay: 0.08 });
    tone(ac, out, t + 0.07, { type: 'triangle', from: 1175, peak: 0.25, decay: 0.16 });
    return 0.28;
  },
  // Cancel: two short falling notes.
  cancel(ac, out, t) {
    tone(ac, out, t, { type: 'triangle', from: 700, peak: 0.22, decay: 0.08 });
    tone(ac, out, t + 0.07, { type: 'triangle', from: 466, peak: 0.22, decay: 0.14 });
    return 0.26;
  },
  // Remove: paper crumpled and dropped in the bin.
  trash(ac, out, t) {
    const gain = noiseBurst(ac, out, t, { length: 0.22, freq: 1800, to: 900, q: 0.8, peak: 0.45 });
    for (let s = 0.015; s < 0.2; s += 0.022) gain.gain.setValueAtTime(0.05 + Math.random() * 0.4, t + s);
    tone(ac, out, t + 0.2, { from: 150, to: 70, glide: 0.08, peak: 0.35, decay: 0.12 });
    return 0.36;
  },
  // Rubber stamp: a hard thump with a paper slap.
  stamp(ac, out, t) {
    tone(ac, out, t, { from: 180, to: 55, glide: 0.09, peak: 0.8, attack: 0.002, decay: 0.16 });
    noiseBurst(ac, out, t, { length: 0.05, filter: 'lowpass', freq: 1400, peak: 0.6, attack: 0.002 });
    noiseBurst(ac, out, t + 0.012, { length: 0.03, filter: 'highpass', freq: 2500, peak: 0.25, attack: 0.001 });
    return 0.22;
  },
  // Typewriter key: a metallic clack and the type bar landing.
  typewriter(ac, out, t) {
    noiseBurst(ac, out, t, { length: 0.02, filter: 'highpass', freq: 3500, peak: 0.55, attack: 0.001 });
    tone(ac, out, t, { type: 'square', from: 2200, to: 1800, glide: 0.02, peak: 0.05, attack: 0.001, decay: 0.03 });
    noiseBurst(ac, out, t + 0.018, { length: 0.04, freq: 600, q: 2, peak: 0.35, attack: 0.002 });
    return 0.08;
  },
  // A page turned or an envelope opened: a papery swish.
  paper(ac, out, t) {
    const gain = noiseBurst(ac, out, t, { length: 0.28, freq: 1200, to: 4200, q: 0.9, peak: 0.3, attack: 0.06 });
    for (let s = 0.07; s < 0.26; s += 0.03) gain.gain.setValueAtTime(0.12 + Math.random() * 0.22, t + s);
    return 0.34;
  },
  // Filing cabinet: a drawer rolling shut with a clunk.
  drawer(ac, out, t) {
    const gain = noiseBurst(ac, out, t, { length: 0.3, filter: 'lowpass', freq: 900, to: 500, peak: 0.35, attack: 0.04 });
    for (let s = 0.05; s < 0.28; s += 0.025) gain.gain.setValueAtTime(0.15 + Math.random() * 0.2, t + s);
    tone(ac, out, t + 0.3, { from: 140, to: 80, glide: 0.06, peak: 0.6, decay: 0.12 });
    noiseBurst(ac, out, t + 0.3, { length: 0.03, filter: 'highpass', freq: 2000, peak: 0.3, attack: 0.001 });
    return 0.46;
  },
  // Heavy iron security doors rolling on their track and meeting in the centre.
  gate(ac, out, t) {
    const grind = noiseBurst(ac, out, t, { length: 0.72, filter: 'bandpass', freq: 260, to: 110, q: 0.7, peak: 0.42, attack: 0.08 });
    for (let s = 0.08; s < 0.7; s += 0.055) {
      grind.gain.setValueAtTime(0.11 + Math.random() * 0.28, t + s);
    }
    tone(ac, out, t + 0.7, { from: 105, to: 42, glide: 0.15, peak: 0.85, attack: 0.002, decay: 0.24 });
    noiseBurst(ac, out, t + 0.7, { length: 0.08, filter: 'lowpass', freq: 720, peak: 0.65, attack: 0.002 });
    tone(ac, out, t + 0.73, { type: 'square', from: 1180, to: 720, glide: 0.1, peak: 0.055, attack: 0.001, decay: 0.18 });
    return 1.02;
  },
  // A step along a track: a short rising pip.
  step(ac, out, t) {
    tone(ac, out, t, { type: 'triangle', from: 600, to: 760, glide: 0.04, peak: 0.3, decay: 0.07 });
    return 0.1;
  },
  // Lanyard clip: a small metal clink, and the badge knocking against it a moment later.
  clink(ac, out, t) {
    noiseBurst(ac, out, t, { length: 0.012, filter: 'highpass', freq: 5000, peak: 0.25, attack: 0.001 });
    [2637, 3951, 5274].forEach((f, i) => tone(ac, out, t, { from: f, peak: 0.16 / (i + 1), attack: 0.001, decay: 0.12 }));
    [3136, 4699].forEach((f, i) => tone(ac, out, t + 0.085, { from: f, peak: 0.09 / (i + 1), attack: 0.001, decay: 0.09 }));
    return 0.2;
  },
  // Card reader: a plastic card sliding into the slot, then the latch catching it.
  cardInsert(ac, out, t) {
    noiseBurst(ac, out, t, { length: 0.16, freq: 2600, to: 1400, q: 1.4, peak: 0.3, attack: 0.03 });
    noiseBurst(ac, out, t + 0.17, { length: 0.015, filter: 'highpass', freq: 2800, peak: 0.45, attack: 0.001 });
    tone(ac, out, t + 0.17, { from: 220, to: 120, glide: 0.04, peak: 0.35, attack: 0.002, decay: 0.07 });
    return 0.26;
  },
  // Card reader accepting a card: two quick piezo beeps, the second higher.
  beep(ac, out, t) {
    tone(ac, out, t, { type: 'square', from: 1976, peak: 0.07, attack: 0.002, decay: 0.07 });
    tone(ac, out, t + 0.1, { type: 'square', from: 2637, peak: 0.07, attack: 0.002, decay: 0.12 });
    return 0.24;
  }
};

// Seconds returned by each voice above. Used by visual effects that synchronize
// their movement to a selected built-in sound without playing it once to measure it.
const VOICE_LENGTHS = {
  eye: 0.5, static: 0.4, globe: 1.2, lock: 0.4, thud: 0.6, alarm: 0.8,
  tick: 0.12, glitch: 0.2, chime: 0.7, fanfare: 1, buzzer: 0.45, descend: 0.6, scan: 0.8,
  click: 0.06, tap: 0.1, pop: 0.14, switch: 0.1, open: 0.24, close: 0.22,
  confirm: 0.28, cancel: 0.26, trash: 0.36, stamp: 0.22, typewriter: 0.08,
  paper: 0.34, drawer: 0.46, gate: 1.02, step: 0.1, clink: 0.2, cardInsert: 0.26, beep: 0.24
};

/** Approximate audible duration of a built-in voice, including its cleanup tail. */
export function synthDuration(id) {
  return VOICE_LENGTHS[id] ? VOICE_LENGTHS[id] + 0.1 : 0;
}

// `button: true` voices are listed first for button slots on /settings.
export const SYNTHS = [
  { id: 'eye', label: 'Eye blip' },
  { id: 'static', label: 'Static crackle' },
  { id: 'globe', label: 'Bell chord' },
  { id: 'lock', label: 'Containment lock' },
  { id: 'thud', label: 'Heavy thud' },
  { id: 'alarm', label: 'Siren' },
  { id: 'tick', label: 'Tick down' },
  { id: 'glitch', label: 'Digital glitch' },
  { id: 'chime', label: 'Chime' },
  { id: 'fanfare', label: 'Fanfare' },
  { id: 'buzzer', label: 'Buzzer' },
  { id: 'descend', label: 'Descending notes' },
  { id: 'scan', label: 'Scanner sweep' },
  { id: 'click', label: 'Click', button: true },
  { id: 'tap', label: 'Soft tap', button: true },
  { id: 'pop', label: 'Pop (add)', button: true },
  { id: 'switch', label: 'Switch', button: true },
  { id: 'open', label: 'Whoosh open', button: true },
  { id: 'close', label: 'Whoosh close', button: true },
  { id: 'confirm', label: 'Confirm notes', button: true },
  { id: 'cancel', label: 'Cancel notes', button: true },
  { id: 'trash', label: 'Crumple (remove)', button: true },
  { id: 'stamp', label: 'Rubber stamp', button: true },
  { id: 'typewriter', label: 'Typewriter key', button: true },
  { id: 'paper', label: 'Paper swish', button: true },
  { id: 'drawer', label: 'Filing drawer', button: true },
  { id: 'gate', label: 'Iron security gate', button: true },
  { id: 'step', label: 'Track step', button: true },
  { id: 'clink', label: 'Lanyard clip', button: true },
  { id: 'cardInsert', label: 'Card into reader', button: true },
  { id: 'beep', label: 'Reader beep', button: true }
];

/** Play a built-in sound; resolves when it has finished. */
export function playSynth(id, volume = 1, { allowPowerOff = false } = {}) {
  const voice = VOICES[id];
  if (!voice || volume <= 0 || (poweredOff && !allowPowerOff)) return Promise.resolve();
  try {
    const ac = getAudioContext({ allowPowerOff });
    const out = ac.createGain();
    out.gain.value = volume;
    out.connect(ac.destination);
    const length = voice(ac, out, ac.currentTime + 0.01);
    return new Promise(resolve => setTimeout(() => { out.disconnect(); resolve(); }, (length + 0.1) * 1000));
  } catch (error) {
    console.warn('playSynth failed', id, error);
    return Promise.resolve();
  }
}
