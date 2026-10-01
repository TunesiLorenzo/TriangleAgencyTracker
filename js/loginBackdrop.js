// loginBackdrop.js
// The moving background of the login screen, in the style of the video behind the main
// screen: red contour lines rippling out of a triangle centred on the logo, crisp next to
// it and molten further out, like looking down a tunnel. login.js nudges it as the sign-in
// goes on: a ring of light at each step, more heat while scanning, and a dive into the
// triangle while the window opens. Drawn with WebGL at a reduced resolution and scaled up;
// without WebGL the stage keeps its plain CSS background.

const MAX_SIDE = 1280;   // longest side of the drawing buffer in px; the canvas is scaled up to the screen

const VERTEX_SHADER = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAGMENT_SHADER = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform vec2 uCenter;      // the logo's centre, in drawing-buffer px from the bottom left
uniform float uSize;       // the outer edge of the logo frame: its circumradius, same px
uniform float uTime;
uniform float uZoom;       // 0 at rest; rises as the window opens (the dive)
uniform float uHeat;       // 0 at rest, 1 when access is granted
uniform float uRing;       // the latest ring of light: its distance from the logo, in logo sizes
uniform float uRingFade;   // 1 when it starts, 0 once it has gone
uniform vec3 uRingColor;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise(p);
    p = p * 2.02 + vec2(17.3, 9.1);
    amplitude *= 0.5;
  }
  return value;
}

// Signed distance to an equilateral triangle pointing up, centred on its centroid (half-side r).
float triangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y += r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  float unit = min(uResolution.x, uResolution.y);
  float size = uSize / unit;
  vec2 p = (gl_FragCoord.xy - uCenter) / unit * exp(-uZoom);
  float r = length(p);
  float t = uTime;

  // The warp grows with the distance: clean triangles round the logo, molten shapes at the edges.
  float reach = smoothstep(size * 0.8, size * 9.0, r);
  vec2 drift = vec2(t * 0.025, -t * 0.018);
  vec2 warp = vec2(fbm(p * 2.2 + drift), fbm(p * 2.2 - drift + 7.7)) - 0.5;
  vec2 curl = vec2(fbm(p * 4.5 + warp * 2.0 + t * 0.03), fbm(p * 4.5 - warp * 2.0 + 3.1)) - 0.5;
  vec2 q = p + reach * (warp * 0.55 + curl * 0.12);

  // Contours packed tight against the logo and spreading out towards the edges, like a
  // tunnel seen from inside; they drift outwards, so the screen seems to move down it.
  float d = max(triangle(q, size * 0.866), 0.0);
  float f = 2.5 * pow(d / size + 0.3, 0.72) - t * 0.3;

  float e = abs(fract(f) - 0.5);                       // 0 on a contour, 0.5 halfway between two
#ifdef GL_OES_standard_derivatives
  float aa = fwidth(f);
#else
  float aa = 0.02;
#endif
  float width = 0.13;
  float core = 1.0 - smoothstep(max(width - aa, 0.0), width + aa, e);
  core = mix(core, width * 2.0, smoothstep(0.15, 0.45, aa));   // too dense to draw: their average
  float halo = exp(-e * 7.0);
  float clear = smoothstep(size * 0.05, size * 0.6, d);        // the logo keeps a little room

  vec3 lineColor = mix(vec3(1.0, 0.17, 0.12), vec3(1.0, 0.72, 0.66), uHeat * 0.35);
  vec3 color = vec3(0.03, 0.006, 0.006);
  color += vec3(0.14, 0.02, 0.025) * exp(-r * 3.0);
  color += lineColor * (core * 0.85 + halo * 0.25) * clear * (0.36 + 0.5 * uHeat);
  // the light inside the triangle, as on the main screen
  color += vec3(1.0, 0.5, 0.48) * exp(-r / size * 1.3) * (0.08 + 0.9 * uHeat);

  float ring = exp(-pow((d / size - uRing) * 2.2, 2.0)) * uRingFade;
  color += uRingColor * ring * (0.25 + core * 0.9);

  gl_FragColor = vec4(color, 1.0);
}`;

const RING_COLORS = { red: [1, 0.25, 0.2], green: [0.19, 0.82, 0.35], white: [1, 0.85, 0.8] };
const RING_SPEED = 5;        // logo sizes per second
const RING_LIFE = 2.6;       // seconds

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn('Login backdrop shader failed', gl.getShaderInfoLog(shader));
  return null;
}

function link(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn('Login backdrop program failed', gl.getProgramInfoLog(program));
  return null;
}

/**
 * Draws the background into `canvas`. `focus()` returns the logo's centre and the
 * circumradius of its frame, in CSS px of the viewport. `animate()` tells whether to move:
 * false (reduced motion) draws still frames. Returns null when WebGL is unavailable.
 */
export function createBackdrop(canvas, { focus, animate }) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return null;
  gl.getExtension('OES_standard_derivatives');
  const program = link(gl);
  if (!program) return null;

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one triangle covers the screen
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniform = Object.fromEntries(['uResolution', 'uCenter', 'uSize', 'uTime', 'uZoom', 'uHeat', 'uRing', 'uRingFade', 'uRingColor']
    .map(name => [name, gl.getUniformLocation(program, name)]));

  const start = performance.now();
  let running = false;
  let frameId = 0;
  let last = 0;
  let heat = 0;
  let ring = { at: -Infinity, color: RING_COLORS.red };
  const controls = {
    heat: 0,     // where the heat is heading; it follows smoothly
    zoom: 0,     // set by the window as it opens or closes
    boost: 0,    // extra heat while the window moves
    ring(color = 'red') {
      ring = { at: performance.now(), color: RING_COLORS[color] || RING_COLORS.red };
    },
    start() {
      running = true;
      if (frameId) return;
      last = performance.now();
      frameId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frameId);
      frameId = 0;
    },
    /** Back to the calm state, for the next time the login shows. */
    reset() {
      heat = controls.heat = controls.zoom = controls.boost = 0;
      ring = { at: -Infinity, color: RING_COLORS.red };
    }
  };

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, MAX_SIDE / Math.max(width, height, 1));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    return scale;
  }

  function draw(now) {
    const moving = animate();
    const scale = resize();
    const { x, y, size } = focus();
    const seconds = moving ? ((now - start) / 1000) % 3600 : 40;
    const ringAge = (now - ring.at) / 1000;

    gl.uniform2f(uniform.uResolution, canvas.width, canvas.height);
    gl.uniform2f(uniform.uCenter, x * scale, canvas.height - y * scale);
    gl.uniform1f(uniform.uSize, Math.max(4, size * scale));
    gl.uniform1f(uniform.uTime, seconds);
    gl.uniform1f(uniform.uZoom, moving ? controls.zoom : 0);
    gl.uniform1f(uniform.uHeat, Math.min(1, Math.max(heat, controls.boost)));
    gl.uniform1f(uniform.uRing, moving ? ringAge * RING_SPEED : -10);
    gl.uniform1f(uniform.uRingFade, moving ? Math.max(0, 1 - ringAge / RING_LIFE) : 0);
    gl.uniform3fv(uniform.uRingColor, ring.color);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    frameId = 0;
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    heat += (controls.heat - heat) * (1 - Math.exp(-dt * 3));
    if (!document.hidden) draw(now);
    // Without motion one still frame is enough; a resize draws it again.
    if (animate()) frameId = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => {
    if (running && !animate()) draw(performance.now());
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    controls.stop();
    canvas.hidden = true;     // the stage's CSS background shows instead
  });

  return controls;
}
