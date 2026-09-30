// soundEffects.js
// Sound engine: maps tracker events and button clicks to the sources assigned on
// /settings (a file under audio/, a built-in synth voice, or silence), applies the
// per-slot and master volume, honours this device's mute toggle, and keeps the
// amplifier awake with a near-silent tone.

import { BUTTON_GROUPS, EVENT_SOUND_BUTTONS, competencyFile, getConfig, onConfigChange } from './config.js';
import { getAudioContext, playSynth } from './synth.js';

const MUTE_KEY = 'ta-muted';
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage unavailable */ }

// Slots with a follow-up sound (e.g. the return-from-sick-leave jingle) are
// exclusive; one-shot effects may overlap so rapid clicks never lose their sound.
let sequencePlaying = false;

export function isMuted() { return muted; }

export function setMuted(value) {
  muted = !!value;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  updateKeepAlive();
}

/* ---------- amplifier keep-alive (from MTG_Table) ----------
   AUX and Bluetooth amplifiers with auto-standby switch off during quiet stretches
   and swallow the start of the next sound. After the first touch or key press (the
   browser allows no audio before one) a very quiet sine runs for as long as the
   viewer is open, so the amp never sees silence. Waking from standby genuinely takes
   hundreds of milliseconds, so sounds wait out WAKE_MS after the tone starts. */
const WAKE_MS = 500;
let keepAliveArmed = false;
let keepAlive = null;   // { oscillator, gain } while the tone runs
let warmUntil = 0;

function stopKeepAlive() {
  if (!keepAlive) return;
  try { keepAlive.oscillator.stop(); } catch { /* already stopped */ }
  keepAlive.gain.disconnect();
  keepAlive = null;
}

/** Start, retune or stop the tone to match the settings and the mute toggle. */
function updateKeepAlive() {
  if (!keepAliveArmed) return;
  const { enabled, frequency, level } = getConfig().sounds.keepAlive;
  if (!enabled || muted) {
    stopKeepAlive();
    return;
  }
  try {
    const ac = getAudioContext();
    if (!keepAlive) {
      const oscillator = ac.createOscillator();
      const gain = ac.createGain();
      oscillator.type = 'sine';
      oscillator.connect(gain);
      gain.connect(ac.destination);
      oscillator.start();
      keepAlive = { oscillator, gain };
      warmUntil = performance.now() + WAKE_MS;
    }
    keepAlive.oscillator.frequency.value = frequency;
    keepAlive.gain.gain.value = level;
  } catch {
    /* No Web Audio or no output device: effects still try on their own. */
  }
}

/** Viewer only: arm the keep-alive tone on the first gesture and follow settings changes. */
export function initKeepAlive() {
  const wake = () => {
    keepAliveArmed = true;
    updateKeepAlive();
    // A context the browser suspended (e.g. after an output device change) resumes on the next gesture.
    if (keepAlive) getAudioContext();
  };
  // Capture, so the tone starts before the pressed button asks for its own sound.
  document.addEventListener('pointerdown', wake, { capture: true, passive: true });
  document.addEventListener('keydown', wake, true);
  onConfigChange(updateKeepAlive);
}

/** Resolves once the amplifier has had time to wake after the keep-alive tone started. */
function warmedUp() {
  const wait = warmUntil - performance.now();
  return wait > 0 ? new Promise(resolve => setTimeout(resolve, wait)) : Promise.resolve();
}

function audioUrl(file) {
  return 'audio/' + file.split('/').map(encodeURIComponent).join('/');
}

// Resolves when the audio ends, errors, or times out.
function playFile(src, volume) {
  return new Promise(resolve => {
    const audio = new Audio(src);
    audio.volume = Math.max(0, Math.min(1, volume));
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      audio.removeEventListener('ended', cleanup);
      audio.removeEventListener('error', cleanup);
      clearTimeout(timeout);
      resolve();
    };

    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);

    // Safety timeout in case 'ended' never fires (e.g. a corrupted file).
    const timeout = setTimeout(cleanup, 10000);

    // play() rejects under autoplay restrictions; just resolve.
    audio.play().catch(err => {
      console.warn('Sound could not play:', src, err);
      cleanup();
    });
  });
}

function playSource(source, volume) {
  if (!source || source === 'none' || volume <= 0) return Promise.resolve();
  if (source.startsWith('synth:')) return playSynth(source.slice(6), volume);
  if (source.startsWith('file:')) return playFile(audioUrl(source.slice(5)), volume);
  return Promise.resolve();
}

/**
 * The slot configured for an event. A competency cue left on "Default" uses its
 * audio/Competencies/<Name>_Bad|_Good file if there is one, else merit/demerit.
 */
export function resolveSlot(event, { competency } = {}) {
  const sounds = getConfig().sounds;
  if (event === 'prime' || event === 'encouraged') {
    const own = sounds.competencies[competency]?.[event];
    if (own?.source) return own;
    const file = competencyFile(competency, event);
    if (file) return { source: `file:${file}`, volume: own?.volume ?? 1, next: '' };
    return sounds.events[event === 'prime' ? 'demerit' : 'merit'];
  }
  return sounds.events[event];
}

/**
 * Play a slot { source, volume, next } regardless of mute (used by the settings page previews).
 * `gain` scales it further (the button volume for button slots).
 */
export async function playSlot(slot, { gain = 1 } = {}) {
  if (!slot) return;
  const volume = (Number(slot.volume) || 0) * (Number(gain) || 0) * (Number(getConfig().sounds.masterVolume) || 0);
  if (!slot.next || slot.next === 'none') {
    await warmedUp();
    await playSource(slot.source, volume);
    return;
  }
  if (sequencePlaying) return;
  sequencePlaying = true;
  try {
    await warmedUp();
    await playSource(slot.source, volume);
    await playSource(slot.next, volume);
  } finally {
    sequencePlaying = false;
  }
}

/** Play the sound assigned to a tracker event, e.g. playEvent('witness'). */
export function playEvent(event, options) {
  if (muted) return Promise.resolve();
  return playSlot(resolveSlot(event, options));
}

/* ---------- button sounds ---------- */
// What counts as a button: real buttons, links, ARIA buttons/tabs/sliders (task cards,
// the relationship tracks), disclosure summaries and checkboxes (a click on a checkbox's
// label arrives here as a click on the checkbox itself).
const CLICKABLE = 'button, a[href], [role="button"], [role="tab"], [role="slider"], summary, input[type="checkbox"]';

// Specific entries first, then each tab's fallback (the sort is stable, so group order holds).
const BUTTONS = BUTTON_GROUPS
  .flatMap(group => group.buttons.map(button => ({ ...button, group: group.key })))
  .sort((a, b) => Number(!!a.fallback) - Number(!!b.fallback));

/** The first entry matching this button, else "Any other button" (the entry with no selector). */
function buttonFor(control) {
  return BUTTONS.find(button => button.selector && control.matches(button.selector)) || BUTTONS.find(button => !button.selector);
}

/** The slot for one button, e.g. buttonSlot('agents', 'addTask'). */
export function buttonSlot(group, key) {
  return getConfig().sounds.buttons[group]?.[key];
}

export function playButton(group, key) {
  if (muted) return Promise.resolve();
  return playSlot(buttonSlot(group, key), { gain: getConfig().sounds.buttonVolume });
}

/** Viewer only: every button click plays the sound set for it on /settings. */
export function initButtonSounds() {
  // Capture phase: plays even when a handler stops the click, and before the handler's own work.
  document.addEventListener('click', event => {
    const control = event.target.closest?.(CLICKABLE);
    if (!control || control.matches(EVENT_SOUND_BUTTONS)) return;
    const button = buttonFor(control);
    if (button) playButton(button.group, button.key);
  }, true);
}
