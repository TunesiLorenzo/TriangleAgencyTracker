export const noise = (function() {
  // --- Create canvas ---
  const canvas = document.createElement('canvas');
  canvas.id = 'noiseOverlay';
  Object.assign(canvas.style, {
    position: 'fixed',    // stays fixed by default
    left: '0',
    top: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '9999',
    mixBlendMode: 'multiply',
    opacity: '0'
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let enabled = false;
  let running = false;
  let timerId = 0;
  // The grain is a small bitmap that the browser stretches over the screen (a few
  // thousand pixels a frame); a screen-sized bitmap redrawn each time cost far more.
  let image = null;
  let pixels = null;

  // --- Default settings ---
  const state = {
    intensity: 0.05,      // visual opacity
    density: 0.12,        // probability for a pixel to be noisy
    frequency: 0.05,      // small buffer scale (0.01..0.5)
    color: null,          // optional RGBA tint
    fps: 12               // grain redraw rate; film grain reads better (and costs far less) below 60fps
  };

  // --- Size the bitmap: the screen's device pixels times `frequency` ---
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(16, Math.min(512, Math.floor(window.innerWidth * dpr * state.frequency)));
    const h = Math.max(16, Math.min(512, Math.floor(window.innerHeight * dpr * state.frequency)));
    if (canvas.width === w && canvas.height === h && image) return;
    canvas.width = w;
    canvas.height = h;
    image = ctx.createImageData(w, h);
    pixels = new Uint32Array(image.data.buffer);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // --- Draw one frame ---
  function drawNoise() {
    const density = state.density;
    for (let i = 0; i < pixels.length; i++) {
      // opaque grey (the same value in every channel, so byte order does not matter), or clear
      pixels[i] = Math.random() < density ? (0xff000000 | (Math.floor(Math.random() * 255) * 0x010101)) >>> 0 : 0;
    }
    ctx.putImageData(image, 0, 0);

    if (state.color) {
      ctx.fillStyle = state.color;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }

    canvas.style.opacity = state.intensity;
  }

  // A timer at the grain's own rate, rather than a 60-per-second frame callback that
  // skipped most of its turns.
  function loop() {
    timerId = 0;
    if (!enabled || state.intensity <= 0 || document.hidden) {
      running = false;
      canvas.style.opacity = 0;
      return;
    }
    running = true;
    drawNoise();
    timerId = window.setTimeout(loop, 1000 / state.fps);
  }

  function stopLoop() {
    window.clearTimeout(timerId);
    timerId = 0;
    running = false;
  }

  function ensureLoop() {
    if (!enabled || running || timerId || state.intensity <= 0 || document.hidden) return;
    loop();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else ensureLoop();
  });

  // --- Public API ---
  return {
    start() {
      enabled = true;
      ensureLoop();
    },
    stop() {
      enabled = false;
      stopLoop();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.opacity = 0;
    },
    setIntensity(v) {
      state.intensity = Math.max(0, Math.min(1, Number(v) || 0));
      if (state.intensity > 0) {
        // Between redraws the grain still follows the level as it eases.
        if (running) canvas.style.opacity = state.intensity;
        ensureLoop();
      } else {
        stopLoop();
        canvas.style.opacity = 0;
      }
    },
    setDensity(v) { state.density = Math.max(0, Math.min(1, Number(v) || 0)); },
    setFrequency(v) {
      state.frequency = Math.max(0.01, Math.min(0.5, Number(v) || 0.05));
      resizeCanvas();
    },
    setColor(rgba) { state.color = rgba || null; },
    setFps(v) { state.fps = Math.max(1, Math.min(60, Number(v) || 12)); },
    setContainerPosition(pos) { canvas.style.position = pos || 'fixed'; },
    isRunning() { return running; },

    // convenience: map chaos (0..1) to intensity
    setChaos(v) { this.setIntensity(Math.max(0, Math.min(1, v))); }
  };
})();
