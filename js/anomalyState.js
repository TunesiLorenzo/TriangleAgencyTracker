import { createUuid } from './uuid.js';

const count = (value, max) => Math.min(max, Math.max(0, Number.parseInt(value, 10) || 0));

export function normalizeAbilityState(data = {}) {
  return { used: !!data?.used, answers: [0, 1].map(i => count(data?.answers?.[i], 3)) };
}

/** Fresh nested objects keep exports and undo snapshots independent of live edits. */
export function normalizeAnomalyState(data = {}) {
  return {
    progress: count(data?.progress, 30),
    abilities: Object.fromEntries(Object.entries(data?.abilities || {}).map(([key, value]) => [key, normalizeAbilityState(value)])),
    custom: (Array.isArray(data?.custom) ? data.custom : []).filter(a => a && typeof a === 'object').map(a => ({
      id: String(a.id || createUuid()),
      name: String(a.name || ''), effects: String(a.effects || ''), question: String(a.question || ''),
      answers: [0, 1].map(i => ({ text: String(a.answers?.[i]?.text || ''), reference: String(a.answers?.[i]?.reference || '') })),
      state: normalizeAbilityState(a.state)
    }))
  };
}
