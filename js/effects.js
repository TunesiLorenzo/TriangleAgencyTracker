function chaosToIntensity(chaos) { return (chaos / 16) };
function chaosToOpacity(chaos) { return Math.min(chaos / 16 * 0.8, 0.8); }

export function stepJitter(wrapper, chaos){
	
  const intensity = chaosToIntensity(chaos);
	
  const x = (Math.random()*2 -1) * intensity * 0.5;
  const y = (Math.random()*2 -1) * intensity * 0.5;
  const r = (Math.random()*2 -1) * (intensity * 0.5);

  wrapper.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg)`;
  requestAnimationFrame(() => stepJitter(wrapper, chaos));
  
}


export function animateCRT(scanline, chars, chaos, bottom) {
    const intensity = chaosToIntensity(chaos);
	const minHeight = 10;   // min height in px
    const maxHeight = 80;  // max height in px
    const bandHeight = minHeight + (maxHeight - minHeight) * intensity;
            crtScanline.style.height = bandHeight + "px";

	scanline.style.opacity = chaosToOpacity(chaos);
	
    chars.forEach(c => {
        const minShadow = 4;   // px
        const maxShadow = 150;  // px
        const shadowSize = minShadow + (maxShadow - minShadow) * intensity;
		crtScanline.background = `rgba(255,255,255,0.05)`;
        crtScanline.style.boxShadow = `0 0 ${shadowSize}px rgba(255,255,255,0.4)`;
    });
    if (!scanline) return;
    bottom += 2;
    if (bottom > window.innerHeight) bottom = 0;
	scanline.style.bottom = bottom +'px';
    requestAnimationFrame(() => animateCRT(scanline, chars, chaos, bottom));
}

export function updateScanlineOverlay(scanlineOverlay,chaosVal) {
    if (!scanlineOverlay) return;
    scanlineOverlay.style.opacity = Math.min(chaosVal / 16 * 0.25);
}