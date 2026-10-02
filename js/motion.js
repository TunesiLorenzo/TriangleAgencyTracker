// The tracker is a theatrical display, so its own default is full motion even when the
// room laptop inherits Windows' reduced-motion setting. Accessibility modes remain
// available explicitly with ?motion=system or ?motion=reduced.
const requested = new URLSearchParams(location.search).get('motion');
const systemPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');

export function motionAllowed() {
  if (requested === 'reduced') return false;
  if (requested === 'system') return !systemPreference?.matches;
  return true;
}

function removeReducedMotionRules(container) {
  let rules;
  try { rules = container.cssRules; } catch { return; }
  if (!rules) return;
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    const condition = rule.conditionText || rule.media?.mediaText || '';
    if (/prefers-reduced-motion\s*:\s*reduce/i.test(condition)) {
      try { container.deleteRule(index); } catch { /* a locked sheet keeps its system behavior */ }
    } else if (rule.cssRules) {
      removeReducedMotionRules(rule);
    }
  }
}

/** Remove CSS reduced-motion overrides before the login or dashboard begins animating. */
export function initMotionPreference() {
  if (!motionAllowed()) return;
  document.documentElement.dataset.motion = 'full';
  [...document.styleSheets].forEach(removeReducedMotionRules);
}
