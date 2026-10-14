// witnesseffects.js
// Witness-driven background tint. The hue rotates red -> magenta -> violet -> blue
// (0deg down to -120deg) so it never passes through yellow/green, eases with a
// time-based curve (same speed at any refresh rate), and a new witness gives a
// short brightness pulse plus a small overshoot instead of a hard color jump.

export function backgroundhue(layer) {
  // Tuned from /settings (config.effects.witnessHue) via configure().
  let maxWitnesses = 20;
  let maxShift = 120;      // degrees; -120 turns red into blue
  let settleTau = 0.35;    // s; about a third of the settle time
  let overshoot = 14;      // degrees past the target on a new witness
  let pulseEnabled = true;
  let lastCount = 0;

  let targetHue = 0;
  let currentHue = 0;
  let rafId = null;
  let lastTime = 0;

  const hueFor = count => -(Math.max(0, Math.min(maxWitnesses, count)) / maxWitnesses) * maxShift;

  function apply() {
    layer.style.filter = Math.abs(currentHue) < 0.05 ? '' : `hue-rotate(${currentHue.toFixed(2)}deg)`;
  }

  function step(now) {
    const dt = Math.min(0.1, (now - (lastTime || now)) / 1000);
    lastTime = now;
    currentHue += (targetHue - currentHue) * (1 - Math.exp(-dt / settleTau));
    if (Math.abs(targetHue - currentHue) < 0.5) { // sub-degree tail is invisible
      currentHue = targetHue;
      apply();
      rafId = null;
      lastTime = 0;
      return;
    }
    apply();
    rafId = requestAnimationFrame(step);
  }

  function pulse() {
    if (!pulseEnabled) return;
    layer.classList.remove('witness-pulse');
    void layer.offsetWidth;
    layer.classList.add('witness-pulse');
  }

  return {
    configure(options) {
      maxWitnesses = Math.max(1, Number(options.maxWitnesses) || 20);
      maxShift = Number(options.maxShift) || 0;
      settleTau = Math.max(0.02, (Number(options.settleSeconds) || 1) / 3);
      overshoot = Number(options.overshoot) || 0;
      pulseEnabled = !!options.pulse;
      targetHue = hueFor(lastCount);
      if (!rafId) rafId = requestAnimationFrame(step);
    },
    setWitnessCount(count, isRapid = false) {
      lastCount = count;
      const previous = targetHue;
      targetHue = hueFor(count);
      if (isRapid) {
        // Past the hue cap the color can't move further, but the pulse still fires.
        if (targetHue !== previous) {
          currentHue = targetHue + Math.sign(targetHue - previous) * overshoot;
          apply();
        }
        pulse();
      }
      if (!rafId) rafId = requestAnimationFrame(step);
    }
  };
}
