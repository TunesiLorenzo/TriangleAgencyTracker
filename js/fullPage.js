// fullpageFit.js
// Usage: import { initFullpageFit } from './fullpageFit.js'; initFullpageFit();

export function initFullpageFit(opts = {}) {
  const wrapper = document.getElementById('pageWrapper');
  if (!wrapper) {
    console.warn('fullpageFit: #pageWrapper not found');
    return;
  }

  const body = document.documentElement; // use <html> to set fullpage class as well
  const fitClass = 'fullpage-fit';
  const scaledClass = 'fullpage-scaled';

  let active = false;
  let lastScale = 1;

  function computeScale() {
    // content natural size — measure the wrapper's scroll size (full content)
    // fallback to bounding rect if scroll dimensions are 0.
    const contentW = Math.max(wrapper.scrollWidth || wrapper.offsetWidth || wrapper.getBoundingClientRect().width, 1);
    const contentH = Math.max(wrapper.scrollHeight || wrapper.offsetHeight || wrapper.getBoundingClientRect().height, 1);

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Choose scale such that content fits within viewport, but do not upscale beyond 1
    const scale = Math.min(1, Math.min(vw / contentW, vh / contentH));

    return { scale, contentW, contentH, vw, vh };
  }

  function applyScale() {
    const { scale } = computeScale();
    lastScale = scale;

    // Add classes that hide scrollbars & center the content
    document.body.classList.add(fitClass);
    document.documentElement.classList.add(fitClass); // set on html too for robust behavior
    wrapper.classList.add(scaledClass);

    // Apply transform scale and keep layout centered via flexbox on body
    wrapper.style.transform = `scale(${scale})`;

    // If we scaled down, disable pointer-events on any underlying scrollable elements? Usually not needed.
    active = true;
  }

  function clearScale() {
    // remove our classes and styles
    wrapper.style.transform = '';
    wrapper.classList.remove(scaledClass);
    document.body.classList.remove(fitClass);
    document.documentElement.classList.remove(fitClass);
    active = false;
  }

  // Debounced resize while active
  let resizeTimer = null;
  function onResize() {
    if (!active) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyScale();
      resizeTimer = null;
    }, 80);
  }

  // Fullscreen change handler: apply when document goes fullscreen, clear when exits
  function onFullscreenChange() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    if (fs) {
      // entering fullscreen -> apply scale
      // small timeout allows browser to finish layout in some environments
      setTimeout(applyScale, 80);
      window.addEventListener('resize', onResize);
    } else {
      // exiting fullscreen -> restore
      clearScale();
      window.removeEventListener('resize', onResize);
    }
  }

  // F11 fallback: some browsers may not fire fullscreenchange with F11; we detect F11 press and then check fullscreen state
  function onKeyDown(e) {
    // 122 is F11, but `e.key === 'F11'` is clearer when available
    if (e.key === 'F11' || e.keyCode === 122) {
      // wait a tick for the browser fullscreen to toggle then run the fullscreen handler
      setTimeout(() => {
        onFullscreenChange();
      }, 120);
    }
  }

  // Optional manual toggle API
  function forceEnterFit() {
    applyScale();
    window.addEventListener('resize', onResize);
  }
  function forceExitFit() {
    clearScale();
    window.removeEventListener('resize', onResize);
  }

  // setup listeners
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('mozfullscreenchange', onFullscreenChange);
  document.addEventListener('MSFullscreenChange', onFullscreenChange);

  window.addEventListener('keydown', onKeyDown);

  // If already in fullscreen at init, apply once
  setTimeout(() => {
    if (document.fullscreenElement) onFullscreenChange();
  }, 50);

  return {
    isActive: () => active,
    getScale: () => lastScale,
    applyScale,
    clearScale,
    destroy() {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      document.removeEventListener('mozfullscreenchange', onFullscreenChange);
      document.removeEventListener('MSFullscreenChange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    }
  };
}
