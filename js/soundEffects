let soundLock = false;

export function playSfx(src) {
  if (soundLock) return; // block if sound already playing
  soundLock = true;

  const audio = new Audio(src);
  audio.play();

  audio.addEventListener('ended', () => {
    soundLock = false; // unlock when finished
  });

  audio.addEventListener('error', () => {
    soundLock = false; // unlock on error too
  });
}