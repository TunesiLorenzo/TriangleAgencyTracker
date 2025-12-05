export function scaleToFit() {
  const container = document.getElementById('pageWrapper'); // or a main wrapper for all content
  if (!container) return;

  // original size of your layout (design-time dimensions)
  const designWidth = window.screen.width;  
  const designHeight = window.screen.height;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // compute scale factor to fit viewport (maintain aspect ratio)
  const scale = Math.min(vw / designWidth, vh / designHeight);

  container.style.transformOrigin = 'top left';
  container.style.transform = `scale(${scale})`;
  container.style.width = `${designWidth}px`;
  container.style.height = `${designHeight}px`;
}

// call on load and on resize/fullscreen change
window.addEventListener('load', scaleToFit);
window.addEventListener('resize', scaleToFit);

// optional: if you have a fullscreen change event
document.addEventListener('fullscreenchange', scaleToFit);
