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

  let running = false;
  let rafId = null;

  // --- Default settings ---
  const state = {
    intensity: 0.05,      // visual opacity
    density: 0.12,        // probability for a pixel to be noisy
    frequency: 0.05,      // small buffer scale (0.01..0.5)
    color: null           // optional RGBA tint
  };

  // --- Initialize canvas ---
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // --- Draw one frame ---
  function drawNoise() {
    const w = Math.max(16, Math.min(512, Math.floor(canvas.width * state.frequency)));
    const h = Math.max(16, Math.min(512, Math.floor(canvas.height * state.frequency)));

    const img = ctx.createImageData(w, h);
    const data = img.data;

    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      if (Math.random() < state.density) {
        const v = Math.floor(Math.random() * 255);
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      } else {
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      }
    }

    const temp = document.createElement('canvas');
    temp.width = w;
    temp.height = h;
    temp.getContext('2d').putImageData(img, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);

    if (state.color) {
      ctx.fillStyle = state.color;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }

    canvas.style.opacity = state.intensity;
  }

  function loop() {
    if (!running) return;
    drawNoise();
    rafId = requestAnimationFrame(loop);
  }

  // --- Public API ---
  return {
    start() {
      if (running) return;
      running = true;
      loop();
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rafId = null;
      canvas.style.opacity = 0;
    },
    setIntensity(v) { state.intensity = Math.max(0, Math.min(1, Number(v) || 0)); },
    setDensity(v) { state.density = Math.max(0, Math.min(1, Number(v) || 0)); },
    setFrequency(v) { state.frequency = Math.max(0.01, Math.min(0.5, Number(v) || 0.05)); },
    setColor(rgba) { state.color = rgba || null; },
    setContainerPosition(pos) { canvas.style.position = pos || 'fixed'; },
    isRunning() { return running; },

    // convenience: map chaos (0..1) to intensity
    setChaos(v) { this.setIntensity(Math.max(0, Math.min(1, v))); }
  };
})();
