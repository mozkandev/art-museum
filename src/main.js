// App orchestration: intro → timeline → placard → gallery.

import { gsap } from "gsap";
import { Timeline } from "./timeline.js";
import { Gallery } from "./gallery.js";
import { getArtist, getPaintings } from "./api.js";
import * as Audio from "./audio.js";

const $ = (sel) => document.querySelector(sel);

// ── INTRO ─────────────────────────────────────────────────────────────────
function setupIntro() {
  const intro = $("#intro");
  const begin = $("#begin-btn");
  const title = intro.querySelector(".intro__title");
  const sub = intro.querySelector(".intro__subtitle");
  const rules = intro.querySelectorAll(".rule");
  const eyebrow = intro.querySelector(".intro__eyebrow");
  const hint = intro.querySelector(".intro__hint");
  const btn = intro.querySelector(".btn--gold");

  gsap.set(intro.querySelectorAll(".intro__title, .intro__subtitle, .intro__eyebrow, .rule, .intro__hint, .btn"), { opacity: 0, y: 20 });

  // Reveal everything on the next frame
  const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
  tl.to(eyebrow, { opacity: 1, y: 0, duration: 0.7 }, 0.2)
    .to(rules, { opacity: 1, y: 0, duration: 0.7, stagger: 0.1 }, 0.4)
    .to(title, { opacity: 1, y: 0, duration: 1.0 }, 0.6)
    .to(sub, { opacity: 1, y: 0, duration: 0.7 }, 1.0)
    .to(hint, { opacity: 1, y: 0, duration: 0.6 }, 1.4)
    .to(btn, { opacity: 1, y: 0, duration: 0.7 }, 1.6);

  begin.addEventListener("click", () => {
    gsap.to(intro, {
      opacity: 0, duration: 0.9, ease: "power2.inOut",
      onComplete: () => {
        intro.classList.add("hidden");
        enterTimeline();
      },
    });
  });
}

// ── TIMELINE ──────────────────────────────────────────────────────────────
let timeline = null;
function enterTimeline() {
  const screen = $("#timeline-screen");
  screen.classList.remove("hidden");
  // Force a synchronous layout pass so the newly-unhidden .screen has a
  // real size before we construct Timeline. Otherwise the viewport's
  // clientWidth can still read 0 in the same tick, _fit() bails, and the
  // world stays pinned to (0,0) looking "off".
  void screen.offsetHeight;
  void $("#timeline-viewport").offsetHeight;
  if (!timeline) {
    timeline = new Timeline({
      viewport: $("#timeline-viewport"),
      world: $("#timeline-world"),
      yearReadout: $("#year-readout"),
      onArtistClick: openPlacard,
    });
  }
  // Always re-fit: first time we want a real centred layout, returning
  // from the gallery (where the screen was display:none) we want to
  // re-evaluate dimensions. _fit() is no-op when dims are 0.
  timeline._fit();
  // Refit once the webfonts have actually loaded — that reflow can change
  // viewport height (e.g. a font that was FOUT'd as wider before it loads).
  // Then once more on the next frame to catch any final layout shifts.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => timeline._fit());
  }
  requestAnimationFrame(() => {
    timeline._fit();
    requestAnimationFrame(() => timeline._fit());
  });
  if (!timeline.started) {
    timeline.start();
    timeline.started = true;
  }
  timeline.reveal();
}

// ── PLACARD ───────────────────────────────────────────────────────────────
function openPlacard(artistName, period) {
  const backdrop = $("#placard-backdrop");
  const body = $("#placard-body");
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.35 });
  gsap.fromTo(
    $("#placard"),
    { opacity: 0, y: 30, rotateX: 12, transformPerspective: 1200, transformOrigin: "50% 0%" },
    { opacity: 1, y: 0, rotateX: 0, duration: 0.65, ease: "power3.out" },
  );
  body.innerHTML = `
    <div class="placard__loader">
      <div class="placard__spinner"></div>
      <div class="placard__loader-text">Consulting the archives…</div>
    </div>`;

  getArtist(artistName)
    .then((a) => renderPlacard(a, period))
    .catch((e) => {
      body.innerHTML = `<div class="placard__error">Couldn't load artist: ${escapeHtml(String(e.message || e))}</div>`;
    });
}

function renderPlacard(a, period) {
  const body = $("#placard-body");
  const portrait = a.thumbnail
    ? `<img class="placard__portrait" src="${escapeAttr(a.thumbnail)}" alt="" />`
    : `<div class="placard__portrait placard__portrait--placeholder" aria-hidden="true"></div>`;
  body.innerHTML = `
    <div class="placard__grid">
      <div class="placard__media">${portrait}</div>
      <div class="placard__text">
        <div class="placard__eyebrow">${period ? escapeHtml(period.name) : "Artist"}</div>
        <h2 id="placard-name" class="placard__name">${escapeHtml(a.name || "")}</h2>
        ${a.description ? `<div class="placard__description">${escapeHtml(a.description)}</div>` : ""}
        ${period ? `<div class="placard__period"><span class="tag">${escapeHtml(period.name)}</span> <span>${period.start}–${period.end}</span></div>` : ""}
        ${a.extract ? `<p class="placard__extract">${escapeHtml(a.extract)}</p>` : ""}
        <div class="placard__actions">
          <button id="enter-gallery" class="btn btn--gold" type="button">Enter the Gallery →</button>
          <a class="placard__source" href="${escapeAttr(a.pageUrl)}" target="_blank" rel="noopener">Source: Wikipedia ↗</a>
        </div>
      </div>
    </div>`;
  $("#enter-gallery").addEventListener("click", () => enterGallery(a, period));
}

function closePlacard() {
  const backdrop = $("#placard-backdrop");
  gsap.to(backdrop, {
    opacity: 0, duration: 0.3,
    onComplete: () => {
      backdrop.classList.add("hidden");
      backdrop.setAttribute("aria-hidden", "true");
    },
  });
}

$("#placard-close").addEventListener("click", closePlacard);
$("#placard-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "placard-backdrop") closePlacard();
});

// ── GALLERY ───────────────────────────────────────────────────────────────
let gallery = null;
let currentArtist = null;
let currentPeriod = null;

function enterGallery(artist, period) {
  closePlacard();
  currentArtist = artist;
  currentPeriod = period;

  // Kick off the procedural ambient music. The click that opened the
  // placard satisfied the browser's autoplay gesture requirement, so
  // AudioContext.resume() will succeed here.
  Audio.unlock();
  Audio.start();

  const enterBtn = $("#enter-gallery");
  if (enterBtn) { enterBtn.disabled = true; enterBtn.textContent = "Collecting the works…"; }

  // Show loading
  const screen = $("#gallery-screen");
  const loading = $("#gallery-loading");
  const prog = $("#gallery-loading-progress");
  const overlay = $("#gallery-lock-overlay");
  const lockTitle = $("#lock-card-title");
  const lockSub = $("#lock-card-sub");

  screen.classList.remove("hidden");
  loading.classList.remove("hidden");
  overlay.classList.add("hidden");
  prog.textContent = "0 / 0";
  lockTitle.textContent = artist.name;
  lockSub.textContent = `${period?.name || ""}`;

  // Set HUD
  $("#gallery-hud-artist").textContent = artist.name;
  $("#gallery-hud-count").textContent = "—";
  $("#gallery-hud").classList.add("hidden");

  let revealed = false;
  let safetyTimer = null;

  getPaintings(artist.name)
    .then((paintings) => {
      console.log("[enterGallery] paintings for", artist.name, paintings.length,
        "urls:", paintings.map(p => (p.url || p.fullUrl || "").slice(0, 80)));
      if (paintings.length < 2) {
        loading.classList.add("hidden");
        overlay.classList.remove("hidden");
        lockTitle.textContent = "Not enough works found";
        lockSub.textContent = "Try another artist on the timeline.";
        if (enterBtn) { enterBtn.disabled = false; enterBtn.textContent = "Enter the Gallery →"; }
        return;
      }
      prog.textContent = `0 / ${paintings.length}`;
      $("#gallery-hud-count").textContent = `${paintings.length} works`;

      gallery = new Gallery({
        container: $("#gallery-canvas"),
        paintings,
        artist: artist.name,
        periodName: period?.name || "",
        artistPortrait: artist.thumbnail || null,
        onProgress: (loaded, total) => {
          if (this.disposed) return;
          prog.textContent = `${loaded} / ${total}`;
          if (!revealed && loaded >= Math.min(4, total)) revealGallery();
        },
      });

      // Cinematic intro, then show the lock overlay
      gallery.intro().then(() => {
        if (this.disposed) return;
        if (!revealed) revealGallery();
      });

      // Safety: always reveal within 9s even if some textures error out
      safetyTimer = setTimeout(() => { if (!revealed) revealGallery(); }, 9000);

      function revealGallery() {
        if (revealed) return;
        revealed = true;
        clearTimeout(safetyTimer);
        loading.classList.add("hidden");
        overlay.classList.remove("hidden");
        $("#gallery-hud").classList.remove("hidden");
        // Reset enter button
        if (enterBtn) { enterBtn.disabled = false; enterBtn.textContent = "Enter the Gallery →"; }
      }
    })
    .catch((e) => {
      loading.classList.add("hidden");
      overlay.classList.remove("hidden");
      lockTitle.textContent = "Couldn't load paintings";
      lockSub.textContent = String(e.message || e);
    });
}

function lockIn() {
  $("#gallery-lock-overlay").classList.add("hidden");
  gallery?.lock();
}

function backToTimeline() {
  // Fade out the gallery music before tearing down the scene.
  Audio.stop();
  if (gallery) {
    gallery.dispose();
    gallery = null;
  }
  $("#gallery-screen").classList.add("hidden");
  $("#gallery-lock-overlay").classList.add("hidden");
  $("#gallery-hud").classList.add("hidden");
  $("#gallery-loading").classList.add("hidden");
  // timeline still mounted
}

document.addEventListener("pointerlockchange", () => {
  if (!gallery) return;
  if (!document.pointerLockElement) {
    // re-show overlay unless we just left the gallery
    if (!$("#gallery-screen").classList.contains("hidden")) {
      $("#gallery-lock-overlay").classList.remove("hidden");
    }
  }
});

$("#lock-enter").addEventListener("click", lockIn);
$("#lock-back").addEventListener("click", backToTimeline);

// ── AUDIO MUTE TOGGLE (M key) ─────────────────────────────────────────────
function updateAudioHint() {
  const el = $("#audio-hint");
  const state = $("#audio-hint-state");
  if (!el || !state) return;
  state.textContent = Audio.isMuted() ? "sound off" : "sound on";
  el.classList.toggle("audio-hint--muted", Audio.isMuted());
}
window.addEventListener("keydown", (e) => {
  // Ignore key events that originated in form fields (none currently, but
  // future-proof).
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "m" || e.key === "M") {
    e.preventDefault();
    Audio.toggleMute();
    updateAudioHint();
  }
});

// ── BOOT ──────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setupIntro();
  updateAudioHint();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
