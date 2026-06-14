// Timeline — DOM-based, GPU-transformed, infinite horizontal canvas.
// Pan with drag, zoom with wheel anchored under the cursor. No
// setPointerCapture (it would retarget clicks on the artist chips).

import { gsap } from "gsap";
import { PERIODS, TIMELINE_MIN_YEAR, TIMELINE_MAX_YEAR } from "./data/periods.js";

const PX_PER_YEAR = 4.8;     // wider spacing so fixed-width cards don't collide
const CARD_W = 280;          // fixed column width — uniform grid of stacks
const TICK_EVERY = 50;
const TICK_LABEL_EVERY = 100;
const AXIS_Y = 0; // logical y of the axis in the world
const REVEAL_SCALE = 0.8;
const CLICK_THRESHOLD = 6;

function yearToX(year) {
  return (year - TIMELINE_MIN_YEAR) * PX_PER_YEAR;
}

export class Timeline {
  constructor({ viewport, world, yearReadout, onArtistClick }) {
    this.viewport = viewport;
    this.world = world;
    this.yearReadout = yearReadout;
    this.onArtistClick = onArtistClick;

    this.view = { x: 0, y: 0, s: 1 };
    this.target = { x: 0, y: 0, s: 1 };

    this._build();
    this._bind();
    this._fit();
  }

  // ── BUILD ────────────────────────────────────────────────────────────────
  _build() {
    this.world.innerHTML = "";

    // Rails (the period-coloured tracks along the axis) sit on the
    // world directly, NOT inside their card — that way they don't move
    // with the card and the visual link to the axis is exact.
    this.rails = [];

    // Axis
    this.axisEl = document.createElement("div");
    this.axisEl.className = "tl-axis";
    this.world.appendChild(this.axisEl);

    // Ticks
    const ticks = document.createElement("div");
    ticks.className = "tl-ticks";
    this.ticksEl = ticks;
    this.axisEl.appendChild(ticks);
    for (let y = TIMELINE_MIN_YEAR; y <= TIMELINE_MAX_YEAR; y += TICK_EVERY) {
      const t = document.createElement("div");
      t.className = "tl-tick";
      if (y % TICK_LABEL_EVERY === 0) {
        t.classList.add("tl-tick--label");
        t.textContent = y;
      }
      t.style.left = `${yearToX(y)}px`;
      ticks.appendChild(t);
    }
    // Axis rule
    const rule = document.createElement("div");
    rule.className = "tl-axis__rule";
    this.axisEl.appendChild(rule);

    // Period columns — laid out left-to-right with no overlap. Each
    // card's left edge is max(year-centre - card_w/2, prev_card_right
    // + gap). That pushes closely-spaced periods to the right of their
    // year-centre so they never collide.
    this.cards = [];
    let nextLeft = -Infinity;
    const COL_GAP = 24;
    PERIODS.forEach((p, i) => {
      // Rail spans the actual year range (true width, no overlap fix)
      const railX = yearToX(p.start);
      const railW = (p.end - p.start) * PX_PER_YEAR;
      const rail = document.createElement("div");
      rail.className = "tl-rail";
      rail.style.setProperty("--pc", p.color);
      rail.style.left = `${railX}px`;
      rail.style.width = `${railW}px`;
      this.world.appendChild(rail);
      this.rails.push(rail);

      // Card: anchor to year-centre, then push right to avoid overlap
      const cx = yearToX((p.start + p.end) / 2);
      const idealLeft = cx - CARD_W / 2;
      const left = Math.max(idealLeft, nextLeft);
      const card = this._buildCard(p, i, left);
      this.world.appendChild(card);
      this.cards.push({ el: card, period: p, left, side: i % 2 === 0 ? -1 : 1 });
      nextLeft = left + CARD_W + COL_GAP;
    });

    // resize observer for re-fitting
    this._ro = new ResizeObserver(() => this._fit());
    this._ro.observe(this.viewport);
  }

  _buildCard(p, i, left) {
    // Each period is a fixed-width column. We position the column by
    // its year-centre but clamp it against the previous card's right
    // edge to prevent overlap (see _build's lay-out pass).
    const w = CARD_W;
    const y = 18; // 18px gap below the axis

    const card = document.createElement("article");
    card.className = "tl-card";
    card.style.setProperty("--pc", p.color);
    card.style.width = `${w}px`;
    card.style.transform = `translate(${left}px, ${y}px)`;
    card.dataset.periodId = p.id;

    card.innerHTML = `
      <div class="tl-card__head">
        <button class="tl-card__title-btn" data-period="${p.id}" type="button">
          <div class="tl-card__years">${p.start}–${p.end}</div>
          <h3 class="tl-card__name">${escapeHtml(p.name)}</h3>
        </button>
        <p class="tl-card__blurb">${escapeHtml(p.blurb)}</p>
      </div>
      <div class="tl-card__artists">
        ${p.artists
          .map(
            (a) => `
          <button class="tl-artist" data-artist="${escapeAttr(a)}" data-period="${p.id}" type="button">
            <span class="tl-artist__num" aria-hidden="true"></span>
            <span class="tl-artist__name">${escapeHtml(a)}</span>
          </button>`,
          )
          .join("")}
      </div>
    `;
    return card;
  }

  // ── EVENTS ───────────────────────────────────────────────────────────────
  _bind() {
    let dragging = false;
    let startX = 0, startY = 0, startViewX = 0, startViewY = 0;
    let downX = 0, downY = 0, moved = 0;

    this.viewport.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      // Don't start a pan on buttons / chips
      if (e.target.closest("button")) return;
      dragging = true;
      downX = e.clientX;
      downY = e.clientY;
      startX = e.clientX;
      startY = e.clientY;
      startViewX = this.target.x;
      startViewY = this.target.y;
      moved = 0;
      this.viewport.setPointerCapture?.(e.pointerId);
      this.viewport.style.cursor = "grabbing";
    });

    this.viewport.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
      this.target.x = startViewX + dx;
      this.target.y = startViewY + dy;
    });

    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      this.viewport.style.cursor = "grab";
      try { this.viewport.releasePointerCapture?.(e.pointerId); } catch {}
    };
    this.viewport.addEventListener("pointerup", stop);
    this.viewport.addEventListener("pointercancel", stop);

    this.viewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // point under cursor in world coords (current)
      const worldX = (mx - this.view.x) / this.view.s;
      const worldY = (my - this.view.y) / this.view.s;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newS = clamp(this.target.s * factor, 0.35, 7);
      // keep that world point under the cursor
      this.target.s = newS;
      this.target.x = mx - worldX * newS;
      this.target.y = my - worldY * newS;
    }, { passive: false });

    // Click delegation: artist chip → openPlacard
    this.world.addEventListener("click", (e) => {
      if (moved > CLICK_THRESHOLD) return; // it was a drag
      const chip = e.target.closest(".tl-artist");
      if (chip) {
        e.stopPropagation();
        const name = chip.dataset.artist;
        const periodId = chip.dataset.period;
        const period = PERIODS.find((p) => p.id === periodId);
        this.onArtistClick?.(name, period);
        return;
      }
      const head = e.target.closest(".tl-card__title-btn");
      if (head) {
        const periodId = head.dataset.period;
        const period = PERIODS.find((p) => p.id === periodId);
        if (period) this.zoomToPeriod(period);
      }
    });
  }

  // ── TRANSFORM / TICK LOOP ────────────────────────────────────────────────
  start() {
    const tick = () => {
      // On the first few frames, re-run _fit() — if the screen was just
      // unhidden, layout may have been 0 and we need a real refit now
      // that the browser has actually computed the viewport size.
      if (this._frames < 30) {
        this._frames = (this._frames || 0) + 1;
        this._fit();
      }
      this.view.x += (this.target.x - this.view.x) * 0.18;
      this.view.y += (this.target.y - this.view.y) * 0.18;
      this.view.s += (this.target.s - this.view.s) * 0.18;
      this.world.style.transform = `translate3d(${this.view.x}px, ${this.view.y + this.viewportH() / 2}px, 0) scale(${this.view.s})`;
      this.world.classList.toggle("zoomed", this.view.s > REVEAL_SCALE);
      this._updateReadout();
      this._raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this._raf);
  }

  viewportH() { return this.viewport.clientHeight; }

  _updateReadout() {
    const cx = this.viewport.clientWidth / 2;
    const worldX = (cx - this.view.x) / this.view.s;
    const year = Math.round(TIMELINE_MIN_YEAR + worldX / PX_PER_YEAR);
    if (this.yearReadout) this.yearReadout.textContent = String(year);
  }

  // ── PUBLIC ───────────────────────────────────────────────────────────────
  reveal() {
    // Only fade in opacity. The Y translate is omitted because cards are
    // already positioned via inline transform: translate(x, y), and GSAP's
    // y:0 would overwrite the y component and snap the card back to the
    // axis (losing the 10px gap).
    const els = this.cards.map((c) => c.el);
    gsap.fromTo(
      els,
      { opacity: 0 },
      { opacity: 1, duration: 0.9, ease: "power3.out", stagger: 0.06 },
    );
    gsap.fromTo(this.axisEl, { opacity: 0 }, { opacity: 1, duration: 1.2, ease: "power2.out" });
  }

  _fit() {
    let w = this.viewport.clientWidth;
    let h = this.viewport.clientHeight;
    // Fall back to window dimensions if the viewport's layout hasn't
    // been computed yet (the screen was just unhidden, the browser
    // hasn't run layout for this element). This keeps _fit() functional
    // on the very first call after enterTimeline().
    if (w < 2) w = window.innerWidth || document.documentElement.clientWidth || 0;
    if (h < 2) h = window.innerHeight || document.documentElement.clientHeight || 0;
    if (w < 2 || h < 2) return; // truly nothing to fit into yet
    const totalW = (TIMELINE_MAX_YEAR - TIMELINE_MIN_YEAR) * PX_PER_YEAR;
    const scaleX = w / (totalW + 200);
    const s = clamp(Math.min(scaleX, 1), 0.35, 1);
    this.target.s = s;
    this.target.x = (w - totalW * s) / 2;
    // Position the axis ~38% from the top of the viewport so cards (which
    // hang below) sit in the lower 60% and the upper portion of the
    // screen is breathable negative space.
    this.target.y = -h * 0.12;
    // Snap view to target so the first paint is already centered (no slide-in
    // from the 0,0 default, which is what made the timeline look "off").
    this.view.x = this.target.x;
    this.view.y = this.target.y;
    this.view.s = this.target.s;
    this.world.style.transform =
      `translate3d(${this.view.x}px, ${this.view.y + h / 2}px, 0) scale(${this.view.s})`;
  }

  zoomToPeriod(period) {
    const w = this.viewport.clientWidth;
    // Use the actual laid-out card position (which respects the
    // no-overlap clamp) rather than a recomputed centre. Falls back
    // to year-centre if the card isn't found.
    const card = this.cards.find((c) => c.period.id === period.id);
    const cardLeft = card ? card.left : yearToX((period.start + period.end) / 2) - CARD_W / 2;
    const s = clamp(w / (w + 100), 0.6, 1.2);
    this.target.s = s;
    this.target.x = w / 2 - (cardLeft + CARD_W / 2) * s;
    this.target.y = -this.viewportH() / 2;
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
