let soundLock = false; // prevents overlapping calls

// playSfx accepts a string or array of strings, mode = 'simultaneous' | 'sequence'
export async function playSfx(sounds, mode = 'simultaneous') {
  if (soundLock) return; // another call is active
  if (!Array.isArray(sounds)) sounds = [sounds];
  if (sounds.length === 0) return;

  soundLock = true;
  try {
    if (mode === 'sequence') {
      for (const src of sounds) {
        await playOne(src);
      }
    } else { // simultaneous
      await Promise.all(sounds.map(s => playOne(s)));
    }
  } finally {
    soundLock = false;
  }
}

// returns a Promise that resolves when the audio ends, errors, or times out
function playOne(src) {
  return new Promise(resolve => {
    const audio = new Audio(src);
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onErr);
      clearTimeout(timeout);
      resolve();
    };

    const onEnd = () => cleanup();
    const onErr = () => cleanup();

    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onErr);

    // safety timeout in case 'ended' never fires (e.g. corrupted file)
    const timeout = setTimeout(() => {
      console.warn('playSfx: timeout for', src);
      cleanup();
    }, 10000); // 15s max per sound

    // Try to play; if play() rejects (autoplay policy), fallback to resolving
    audio.play().catch(err => {
      console.warn('playSfx: play() rejected for', src, err);
      cleanup();
    });
  });
}
