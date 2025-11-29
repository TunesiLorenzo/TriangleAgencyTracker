export function backgroundhue(layer, options = {}) {
    let targetHue = 0;
    let currentHue = 0;
    let rafId = null;
    const maxWitnesses = 20;

    const smoothing = options.smoothing ?? 0.01;       // normal easing
    const rapidSmoothing = options.rapidSmoothing ?? 0.3; // optional faster return

    function updateTarget(count) {
        const c = Math.max(0, Math.min(maxWitnesses, count));
        targetHue = (c / maxWitnesses) * 240; // 0=red, 240=blue
    }

    function rapidShift(isIncrease) {
        currentHue = isIncrease ? 240 : 360;
        layer.style.filter = `hue-rotate(${currentHue}deg)`;
        // start normal easing back toward targetHue
        if(!rafId) rafId = requestAnimationFrame(step);
    }

    function step() {
        const diff = targetHue - currentHue;
        if(Math.abs(diff) < 0.5) {
            currentHue = targetHue;
            layer.style.filter = `hue-rotate(${currentHue}deg)`;
            rafId = null;
            return;
        }
        // use normal smoothing
        currentHue += diff * smoothing;
        layer.style.filter = `hue-rotate(${currentHue}deg)`;
        rafId = requestAnimationFrame(step);
    }

    return {
        setWitnessCount(count, isRapid=false) {
            const increasing = count > ((targetHue / 240) * maxWitnesses);
            updateTarget(count);
            if(isRapid) rapidShift(increasing);
            else if(!rafId) rafId = requestAnimationFrame(step);
        }
    };
}
