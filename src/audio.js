// src/audio.js
// Procedural ambient gallery music — generated in the browser with the Web
// Audio API so we don't ship audio files. The sound is a slow minor-key
// string-pad drone (detuned sawtooth + lowpass + convolution-free reverb
// approximated with feedback delay) with a gentle arpeggio on top. Loops
// indefinitely; fades in over 4s on enter, fades out on leave.
//
// The first user gesture (click / key) is required to unlock AudioContext
// in modern browsers; call unlock() from a click handler if start() is
// called too early.

let ctx = null;
let masterGain = null;
let started = false;
let scheduled = []; // intervals + timeouts for arpeggio
let muted = false; // user-controlled mute (M key)

// A minor: A2..A3 — the "old gallery" base.
const ROOT_FREQ = 110; // A2
const CHORD_HZ = [
  // Stack of 5ths + a flat-VII, common in Baroque/Renaissance minor.
  [110.0, 164.81, 196.0, 261.63, 329.63], // A, E, G, C, E (Am add9 voicing)
  [110.0, 164.81, 220.0, 261.63, 329.63], // A, E, A, C, E
  [116.54, 174.61, 220.0, 277.18, 349.23], // B, F, A, C#, F (Bdim flavor)
  [98.0, 146.83, 196.0, 261.63, 311.13],   // G, D, G, C, Eb (iv chord on G)
];
// Soft top arpeggio — pentatonic minor over A.
const ARP_HZ = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0; // start silent, fade in
  masterGain.connect(ctx.destination);
  return ctx;
}

/** Call from a user gesture (click) to satisfy autoplay policy. */
export function unlock() {
  ensureContext();
  if (ctx && ctx.state === "suspended") ctx.resume();
}

/** Start the ambient music. Idempotent. */
export function start() {
  ensureContext();
  if (!ctx || started) return;
  if (ctx.state === "suspended") ctx.resume();
  started = true;

  // ── Voice 1: low drone (A2 + a 7Hz beating sine, very subtle) ─────────
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.0;
  droneGain.connect(masterGain);
  const droneLP = ctx.createBiquadFilter();
  droneLP.type = "lowpass";
  droneLP.frequency.value = 220;
  droneLP.Q.value = 0.6;
  droneLP.connect(droneGain);

  const drone1 = ctx.createOscillator();
  drone1.type = "sine";
  drone1.frequency.value = ROOT_FREQ;
  drone1.connect(droneLP);
  drone1.start();

  const drone2 = ctx.createOscillator();
  drone2.type = "sine";
  drone2.frequency.value = ROOT_FREQ * 1.005; // slight beating
  drone2.connect(droneLP);
  drone2.start();

  // ── Voice 2: pad — detuned sawtooth chord, lowpassed ──────────────────
  const padGain = ctx.createGain();
  padGain.gain.value = 0.0;
  padGain.connect(masterGain);
  const padLP = ctx.createBiquadFilter();
  padLP.type = "lowpass";
  padLP.frequency.value = 700;
  padLP.Q.value = 0.4;
  padLP.connect(padGain);
  const padHP = ctx.createBiquadFilter();
  padHP.type = "highpass";
  padHP.frequency.value = 90;
  padHP.connect(padLP);

  const padOscs = [];
  for (const chord of CHORD_HZ) {
    for (const f of chord) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      // Detune by a few cents so the chord shimmers
      o.detune.value = (Math.random() - 0.5) * 14;
      o.connect(padHP);
      o.start();
      padOscs.push(o);
    }
  }

  // ── Voice 3: high arpeggio (single sine, very quiet, slow) ────────────
  const arpGain = ctx.createGain();
  arpGain.gain.value = 0.0;
  arpGain.connect(masterGain);
  const arpLP = ctx.createBiquadFilter();
  arpLP.type = "lowpass";
  arpLP.frequency.value = 2400;
  arpLP.connect(arpGain);

  // Schedule a slow arpeggio in A minor pentatonic. 16 steps, ~1.2s apart
  // → about 19s per loop, varied by chord changes below.
  let step = 0;
  const stepInterval = 1100; // ms
  const playStep = () => {
    if (!started || !ctx) return;
    const note = ARP_HZ[step % ARP_HZ.length];
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = note;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1);
    o.connect(g).connect(arpLP);
    o.start();
    o.stop(ctx.currentTime + 1.2);
    step++;
  };
  const arpInterval = setInterval(playStep, stepInterval);
  scheduled.push(arpInterval);

  // ── Crossfade: every ~25s, swap chord set to keep it moving ──────────
  let chordIdx = 0;
  const swapChord = () => {
    if (!started || !ctx) return;
    chordIdx = (chordIdx + 1) % CHORD_HZ.length;
    const next = CHORD_HZ[chordIdx];
    let i = 0;
    for (const f of next) {
      const target = padOscs[i++];
      if (!target) break;
      target.frequency.linearRampToValueAtTime(f, ctx.currentTime + 4);
    }
  };
  const chordInterval = setInterval(swapChord, 25000);
  scheduled.push(chordInterval);
  // Kick off the arp immediately so the gallery isn't silent for 1s.
  playStep();

  // ── Fade in the master + per-voice levels (volume reduced ~50% from
  // the original levels — gallery ambience should be felt, not heard).
  const now = ctx.currentTime;
  const targetMaster = muted ? 0 : 0.16;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(0, now);
  masterGain.gain.linearRampToValueAtTime(targetMaster, now + 4.0);
  droneGain.gain.linearRampToValueAtTime(0.45, now + 4.0);
  padGain.gain.linearRampToValueAtTime(0.25, now + 4.0);
  arpGain.gain.linearRampToValueAtTime(0.6, now + 4.0);

  // Stash refs so stop()/mute() can fade & tear down.
  ctx._gallery = { droneGain, padGain, arpGain, padOscs, drone1, drone2 };
}

/** Stop and tear down. Safe to call multiple times. */
export function stop() {
  if (!ctx || !started) return;
  started = false;
  const g = ctx._gallery;
  if (g) {
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, now + 1.5);
    g.droneGain.gain.linearRampToValueAtTime(0, now + 1.5);
    g.padGain.gain.linearRampToValueAtTime(0, now + 1.5);
    g.arpGain.gain.linearRampToValueAtTime(0, now + 1.5);
    setTimeout(() => {
      try { g.drone1.stop(); g.drone2.stop(); } catch (_) {}
      for (const o of g.padOscs) { try { o.stop(); } catch (_) {} }
    }, 1700);
  }
  for (const id of scheduled) clearInterval(id);
  scheduled = [];
}

/** Toggle the mute. Returns the new muted state. */
export function toggleMute() {
  muted = !muted;
  if (ctx && masterGain && started) {
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(muted ? 0 : 0.16, now + 0.4);
  }
  return muted;
}

/** Read-only state. */
export function isMuted() {
  return muted;
}
