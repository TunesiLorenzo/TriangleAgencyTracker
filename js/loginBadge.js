// loginBadge.js
// The Manager badge on its lanyard and the card reader beside the login form. The badge
// drops in from the top of the screen and swings, a hand pushes it into the reader's slot,
// the reader pushes it back out, and it hangs there until the lanyard pulls it away at the
// end of the sign-in. The swing is a small pendulum simulation; login.js decides when each
// move starts and how long it takes.

const SWING_PERIOD = 1.6;      // seconds: a long lanyard swings slowly
const SWING_DAMPING = 0.08;    // left alone, a swing dies out over a few seconds
const HELD_STIFFNESS = 9;      // a hand steadying it: much stiffer...
const HELD_DAMPING = 1.6;      // ...and no overshoot
const TWIST_PERIOD = 4.4;      // the card slowly turns on the lanyard while it hangs
const TWIST_DEGREES = 7;
const DROP_SWING = 9;          // degrees: it arrives swinging
const DROP_FALL = 0.62;        // share of the drop spent falling; the rest is the lanyard catching it
const INSERT_SHARE = 0.56;     // share of the card that goes into the reader
const PIVOT_ABOVE = 0.35;      // the lanyard's far end, in screen heights above the top edge

/** Distance from the top of `ancestor` to the top of `element`, by layout (transforms aside). */
function offsetWithin(element, ancestor) {
  let top = 0;
  for (let node = element; node && node !== ancestor; node = node.offsetParent) top += node.offsetTop;
  return top;
}

const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeInCubic = t => t * t * t;
const easeOutBack = t => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

/**
 * `badge` moves up and down, `swing` (inside it) swings and twists, `card` is the card
 * itself, and the middle of `slit` is where the card disappears into the reader. All of
 * them sit in the same positioned rig. `animate()` tells whether to move: without motion
 * every step lands at once.
 */
export function createBadgeRig({ badge, swing, card, slit, animate }) {
  let metrics = null;
  let y = 0;              // px below the hanging position
  let angle = 0;          // degrees, positive is clockwise
  let velocity = 0;       // degrees per second
  let twist = 0;
  let twistShare = 0;     // 0..1, how freely it turns: none while held
  let twistPhase = 0;
  let held = false;       // a hand keeps it straight (on its way into the reader, and inside)
  let kick = 0;           // swing to give it once it is clear of the reader
  let tween = null;
  let frameId = 0;
  let last = 0;

  /** Positions inside the rig, from the layout (transforms do not change these). */
  function measure() {
    const rig = badge.offsetParent;
    const cardTop = offsetWithin(card, rig);
    const cardHeight = card.offsetHeight;
    const slotY = offsetWithin(slit, rig) + slit.offsetHeight / 2;
    metrics = {
      cardHeight,
      slotY: slotY - cardTop,                                   // the slot line, from the card's top at rest
      depth: slotY - cardTop - cardHeight + cardHeight * INSERT_SHARE,
      away: -(cardTop + cardHeight + card.offsetWidth * 0.4)    // entirely above the screen, clip and all
    };
    swing.style.transformOrigin = `50% ${-(cardTop + window.innerHeight * PIVOT_ABOVE)}px`;
    return metrics;
  }

  function apply() {
    badge.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    swing.style.transform = `rotate(${angle.toFixed(3)}deg) rotateY(${twist.toFixed(2)}deg)`;
    // The part of the card below the slot line is inside the reader.
    const line = metrics.slotY - y;
    badge.style.clipPath = line < metrics.cardHeight
      ? `polygon(-400% -9999px, 500% -9999px, 500% ${line.toFixed(1)}px, -400% ${line.toFixed(1)}px)`
      : '';
  }

  function step(dt) {
    const omega = 2 * Math.PI / SWING_PERIOD;
    const stiffness = omega * omega * (held ? HELD_STIFFNESS : 1);
    const damping = 2 * omega * (held ? HELD_DAMPING * Math.sqrt(HELD_STIFFNESS) : SWING_DAMPING);
    velocity += (-stiffness * angle - damping * velocity) * dt;
    angle += velocity * dt;
    twistShare += ((held ? 0 : 1) - twistShare) * Math.min(1, dt * (held ? 8 : 1.5));
    twistPhase += dt * 2 * Math.PI / TWIST_PERIOD;
    twist = TWIST_DEGREES * twistShare * Math.sin(twistPhase);
  }

  function frame(now) {
    const elapsed = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (tween) {
      const progress = Math.min(1, (now - tween.start) / tween.duration);
      y = tween.at(progress);
      if (progress >= 1) {
        const { done } = tween;
        tween = null;
        done?.();
      }
    }
    // Pushed back out: it starts to swing once it is clear of the slot.
    if (kick && y + metrics.cardHeight < metrics.slotY) {
      held = false;
      velocity += kick;
      kick = 0;
    }
    // Small steps keep the stiff, steadied pendulum stable.
    for (let left = elapsed; left > 0; left -= 1 / 240) step(Math.min(left, 1 / 240));
    apply();
    frameId = requestAnimationFrame(frame);
  }

  function run() {
    if (frameId || !animate()) return;
    last = performance.now();
    frameId = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(frameId);
    frameId = 0;
  }

  /** Moves to `to` px over `duration` ms along `shape`; resolves when it gets there. */
  function moveTo(to, duration, shape) {
    if (!animate()) {
      y = to;
      apply();
      return Promise.resolve();
    }
    const from = y;
    return new Promise(resolve => {
      tween = { start: performance.now(), duration: Math.max(1, duration), at: p => from + (to - from) * shape(p), done: resolve };
      run();
    });
  }

  window.addEventListener('resize', () => {
    if (metrics) measure();
  });

  return {
    /** Falls in from above the screen, swinging, and the lanyard catches it. */
    drop(duration, { onCatch } = {}) {
      const { away } = measure();
      y = away;
      held = false;
      kick = 0;
      angle = animate() ? DROP_SWING : 0;
      velocity = 0;
      twistShare = animate() ? 1 : 0;
      apply();
      if (!animate()) {
        onCatch?.();
        return moveTo(0, 0);
      }
      const bounce = card.offsetWidth * 0.07;
      const promise = moveTo(0, duration, p => {
        if (p < DROP_FALL) return (p / DROP_FALL) ** 2;
        const s = (p - DROP_FALL) / (1 - DROP_FALL);
        return 1 + (bounce / -away) * Math.sin(s * Math.PI * 2) * (1 - s) ** 2;
      });
      if (onCatch) setTimeout(onCatch, duration * DROP_FALL);
      return promise;
    },
    /** Steadied and pushed straight down into the reader. */
    insert(duration) {
      held = true;
      return moveTo(metrics.depth, duration, easeInOutCubic);
    },
    /** The reader pushes it back out; it swings a little once it is free. */
    eject(duration) {
      kick = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 10);
      if (!animate()) {
        held = false;
        kick = 0;
      }
      return moveTo(0, duration, easeOutBack);
    },
    /** The lanyard pulls it up off the screen (without motion it fades where it is, in CSS). */
    leave(duration) {
      if (!animate() || !metrics) return Promise.resolve();
      return moveTo(metrics.away, duration, easeInCubic);
    },
    /** Out of sight and still, for the next sign-in. */
    reset() {
      stop();
      tween = null;
      held = false;
      kick = 0;
      angle = velocity = twist = twistShare = 0;
      badge.style.transform = '';
      badge.style.clipPath = '';
      swing.style.transform = '';
    }
  };
}
