// lights.js
// Room lights: sends the light cue set on /settings for a tracker event to the
// tracker server, which forwards it to LightRPG (see lights.py). Lights ignore
// this screen's mute button, and do nothing without the Flask server.

import { getConfig, isServerAvailable } from './config.js';

/** Send one cue now (the settings page tests cues this way). */
export function sendLightCue(cue, lights = getConfig().lights) {
  return fetch('/api/lights/cue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cue, ambient: lights.ambient, target: lights.target })
  }).then(response => response.json()).catch(() => ({ ok: false, message: 'The tracker server is not running' }));
}

/** Cue the lights for a tracker event, e.g. triggerLight('witness'). */
export function triggerLight(event) {
  const lights = getConfig().lights;
  const cue = lights.events[event];
  if (!lights.enabled || !isServerAvailable() || !cue || cue.action === 'none') return;
  sendLightCue(cue, lights);
}
