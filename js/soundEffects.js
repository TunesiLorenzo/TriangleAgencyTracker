// soundEffects.js
// Sound engine: maps tracker events to the sources assigned on /settings
// (a file under audio/, a built-in synth voice, or silence), applies the
// per-slot and master volume, and honours this device's mute toggle.

import { competencyFile, getConfig } from './config.js';
import { playSynth } from './synth.js';

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

/** Play a slot { source, volume, next } regardless of mute (used by the settings page previews). */
export async function playSlot(slot) {
  if (!slot) return;
  const volume = (Number(slot.volume) || 0) * (Number(getConfig().sounds.masterVolume) || 0);
  if (!slot.next || slot.next === 'none') {
    await playSource(slot.source, volume);
    return;
  }
  if (sequencePlaying) return;
  sequencePlaying = true;
  try {
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
