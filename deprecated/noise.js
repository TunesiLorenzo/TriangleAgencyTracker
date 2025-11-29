export const noise = (function(){
  // create full-viewport canvas once
	const canvas = document.createElement('canvas');
 canvas.id = 'noiseOverlay';
Object.assign(canvas.style, {
  position: "fixed",
  left: "0",
  top: "0",
  width: "100vw",
  height: "100vh",
  pointerEvents: "none",
  zIndex: "9999",
  mixBlendMode: "multiply"
});
	 
	 document.body.appendChild(canvas);
	 const ctx = canvas.getContext('2d');

  // initialize full-size buffer once (no resize handler)
  function initCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(window.innerWidth));
    const h = Math.max(1, Math.floor(window.innerHeight));
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Default settings you asked for
  const state = {
    intensity: 0.06,   // visual opacity of overlay (0..1)
    density: 0.12,     // fraction of noisy pixels in the offscreen buffer (0..1)
    frequency: 0.05,   // detail scale: portion of canvas used for small buffer (0.01..0.5)
    color: null,       // null or 'rgba(r,g,b,a)' to tint the noise
    running: false
  };

  let rafId = null;

  // draw one frame: create small offscreen ImageData determined by frequency,
  // then scale up to cover full canvas (fast)
  function drawNoiseFrame(){
    // compute offscreen size from frequency (higher frequency => more detail)
    const offW = Math.max(16, Math.min(512, Math.floor(canvas.width * state.frequency)));
    const offH = Math.max(16, Math.min(512, Math.floor(canvas.height * state.frequency)));

    // create small image data
    const img = ctx.createImageData(offW, offH);
    const data = img.data;
    const density = Math.max(0, Math.min(1, state.density));

    for (let i = 0, len = offW * offH; i < len; i++) {
      const idx = i * 4;
      if (Math.random() < density) {
        const v = Math.floor(Math.random() * 255);
        data[idx] = v;
        data[idx+1] = v;
        data[idx+2] = v;
        data[idx+3] = 255;
      } else {
        data[idx] = 0;
        data[idx+1] = 0;
        data[idx+2] = 0;
        data[idx+3] = 0;
      }
    }

    // draw the small buffer to a temporary canvas, then scale to full canvas
    const temp = document.createElement('canvas');
    temp.width = offW;
    temp.height = offH;
    const tctx = temp.getContext('2d');
    tctx.putImageData(img, 0, 0);

    // clear and draw scaled to full internal buffer
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);

    // apply tint if provided (tint covers the whole canvas with composite)
    if (state.color) {
      ctx.fillStyle = state.color;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }

    // set visual opacity (intensity)
    canvas.style.opacity = String(Math.max(0, Math.min(1, state.intensity)));
  }

  function loop(){
    if (!state.running) return;
    drawNoiseFrame();
    rafId = requestAnimationFrame(loop);
  }

  // public API
  initCanvas();

  return {
    start(){
      if (state.running) return;
      state.running = true;
      loop();
    },
    stop(){
      state.running = false;
      if (rafId){ cancelAnimationFrame(rafId); rafId = null; }
      ctx.clearRect(0,0,canvas.width,canvas.height);
    },
    // reinitialize canvas if viewport changed (optional since you removed resize)
    reinit(){
      this.stop();
      initCanvas();
    },
    // setters
    setIntensity(v){ state.intensity = Math.max(0, Math.min(1, Number(v) || 0)); canvas.style.opacity = state.intensity; },
    setDensity(v){ state.density = Math.max(0, Math.min(1, Number(v) || 0)); },
    setFrequency(v){ state.frequency = Math.max(0.01, Math.min(0.5, Number(v) || 0.05)); },
    setColor(rgbaString){ state.color = rgbaString || null; },
    // convenience: update multiple from your chaos value (chaos in 0..1)
    isRunning(){ return state.running; }
  };
})();
