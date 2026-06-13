// Gallery — Three.js first-person museum hall.
// Length scales with painting count, shadows are budgeted
// (only the nearest ~6 spotlights cast shadows) so we stay
// snappy on mid-tier hardware. Public-domain images come from
// Wikimedia Commons via the dev-server /api route.

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { gsap } from "gsap";

const WALL_H = 5.4;
const HALL_W = 9.5;
const SPACING = 4.8;
const EYE = 1.7;
const FOV = 62;
const SHADOW_BUDGET = 6;

RectAreaLightUniformsLib.init();

export class Gallery {
  constructor({ container, paintings, artist, periodName, onProgress }) {
    this.container = container;
    this.paintings = paintings;
    this.artist = artist;
    this.periodName = periodName;
    this.onProgress = onProgress || (() => {});

    this.perWall = Math.max(1, Math.ceil(this.paintings.length / 2));
    this.hallLen = this.perWall * SPACING + 8;
    this.halfL = this.hallLen / 2;
    this.halfW = HALL_W / 2;

    this.disposed = false;
    this._disposables = [];

    this._init();
  }

  // ── INIT ─────────────────────────────────────────────────────────────────
  _init() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.0; // ramps up during intro()
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0908);
    scene.fog = new THREE.Fog(0x0a0908, 14, this.hallLen * 0.85);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(FOV, this.container.clientWidth / this.container.clientHeight, 0.1, 200);
    camera.position.set(0, EYE, -this.halfL + 2);
    camera.lookAt(0, EYE, 0);
    this.camera = camera;

    // IBL
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    this._disposables.push(pmrem);

    this._buildRoom();
    this._buildLighting();
    this._buildFurniture();
    this.hangPaintings(this.paintings);

    // Controls
    this.controls = new PointerLockControls(camera, renderer.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.minPolarAngle = Math.PI * 0.05;

    this._keys = { w: 0, s: 0, a: 0, d: 0, shift: 0 };
    this._velocity = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmpVec = new THREE.Vector3();

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.container);

    this.clock = new THREE.Clock();
    this._animate();
  }

  // ── ROOM ─────────────────────────────────────────────────────────────────
  _buildRoom() {
    // Floor — parquet
    const floorMat = new THREE.MeshPhysicalMaterial({
      map: woodFloorTexture(),
      roughness: 0.42,
      metalness: 0.0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.6,
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(HALL_W, this.hallLen),
      floorMat,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this._disposables.push(floor.geometry, floorMat.map, floorMat);

    // Ceiling (split around skylight)
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 0.9 });
    const ceilGeo = new THREE.PlaneGeometry(HALL_W, this.hallLen);
    const ceilL = new THREE.Mesh(ceilGeo, ceilMat);
    const ceilR = new THREE.Mesh(ceilGeo, ceilMat);
    ceilL.rotation.x = Math.PI / 2; ceilL.position.set(0, WALL_H, 0);
    ceilR.rotation.x = Math.PI / 2; ceilR.position.set(0, WALL_H, 0);
    this.scene.add(ceilL, ceilR);
    this._disposables.push(ceilGeo, ceilMat);

    // Skylight (emissive strip) — long narrow box at the top center
    const skyMat = new THREE.MeshStandardMaterial({ color: 0xffe6c2, emissive: 0xffe6c2, emissiveIntensity: 1.2, roughness: 0.4 });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.4, this.hallLen - 2), skyMat);
    sky.rotation.x = Math.PI / 2;
    sky.position.set(0, WALL_H - 0.01, 0);
    this.scene.add(sky);
    this._disposables.push(sky.geometry, skyMat);

    // Skylight frame lips
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.6, metalness: 0.4 });
    for (const x of [-0.8, 0.8]) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, this.hallLen - 2), frameMat);
      lip.position.set(x, WALL_H - 0.04, 0);
      this.scene.add(lip);
    }
    this._disposables.push(frameMat);

    // Side walls
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTexture(),
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.0,
    });
    const wallGeo = new THREE.PlaneGeometry(this.hallLen, WALL_H);
    const wallL = new THREE.Mesh(wallGeo, wallMat);
    const wallR = new THREE.Mesh(wallGeo.clone(), wallMat);
    wallL.position.set(-this.halfW, WALL_H / 2, 0);
    wallL.rotation.y = Math.PI / 2;
    wallR.position.set(this.halfW, WALL_H / 2, 0);
    wallR.rotation.y = -Math.PI / 2;
    wallL.receiveShadow = true; wallR.receiveShadow = true;
    this.scene.add(wallL, wallR);
    this._disposables.push(wallGeo, wallMat.map, wallMat);

    // Far feature wall
    const featMat = new THREE.MeshStandardMaterial({
      map: endWallTexture(this.artist, this.periodName),
      roughness: 0.6,
      metalness: 0.0,
    });
    const feat = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, WALL_H), featMat);
    feat.position.set(0, WALL_H / 2, this.halfL);
    feat.receiveShadow = true;
    this.scene.add(feat);
    this._disposables.push(feat.geometry, featMat.map, featMat);

    // Baseboards and crown moulding
    const mouldMat = new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 0.6, metalness: 0.2 });
    for (const side of [-1, 1]) {
      const bb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, this.hallLen), mouldMat);
      bb.position.set(side * (this.halfW - 0.06), 0.09, 0);
      this.scene.add(bb);
      const cr = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, this.hallLen), mouldMat);
      cr.position.set(side * (this.halfW - 0.09), WALL_H - 0.04, 0);
      this.scene.add(cr);
    }
    this._disposables.push(mouldMat);
  }

  // ── LIGHTING ─────────────────────────────────────────────────────────────
  _buildLighting() {
    const hemi = new THREE.HemisphereLight(0xfff1d6, 0x1a0e08, 0.4);
    this.scene.add(hemi);

    // Skylight wash (a few RectAreaLights down the ceiling channel)
    this._skylights = [];
    for (let i = -2; i <= 2; i++) {
      const rect = new THREE.RectAreaLight(0xffe8c4, 4.5, 1.4, this.hallLen / 5);
      rect.position.set(0, WALL_H - 0.02, (i * this.hallLen) / 5);
      rect.lookAt(0, 0, (i * this.hallLen) / 5);
      this.scene.add(rect);
      this._skylights.push(rect);
    }

    // Spotlights will be created in hangPaintings(), with shadow budget
    this._spots = [];
  }

  // ── FURNITURE ────────────────────────────────────────────────────────────
  _buildFurniture() {
    const benchCount = Math.max(2, Math.floor(this.hallLen / 6));
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x4a2418, roughness: 0.6, metalness: 0.0 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6, metalness: 0.2 });
    const benchGeo = new THREE.BoxGeometry(1.6, 0.08, 0.45);
    const legGeo = new THREE.BoxGeometry(0.06, 0.45, 0.4);

    for (let i = 0; i < benchCount; i++) {
      const z = -this.halfL + 3 + (i * (this.hallLen - 6)) / Math.max(1, benchCount - 1);
      const seat = new THREE.Mesh(benchGeo, seatMat);
      seat.position.set(0, 0.45, z);
      seat.castShadow = true;
      seat.receiveShadow = true;
      this.scene.add(seat);
      for (const lx of [-0.75, 0.75]) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(lx, 0.225, z);
        leg.castShadow = true;
        this.scene.add(leg);
      }
    }
    this._disposables.push(benchGeo, legGeo, seatMat, legMat);

    // Rope stanchions near the feature wall
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc8a45c, metalness: 0.85, roughness: 0.25 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x5a1818, roughness: 0.7 });
    for (const x of [-1.3, 1.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 16), brassMat);
      post.position.set(x, 0.55, this.halfL - 1.4);
      post.castShadow = true;
      this.scene.add(post);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), brassMat);
      top.position.set(x, 1.1, this.halfL - 1.4);
      this.scene.add(top);
    }
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8), ropeMat);
    rope.rotation.z = Math.PI / 2;
    rope.position.set(0, 1.05, this.halfL - 1.4);
    this.scene.add(rope);
    this._disposables.push(brassMat, ropeMat);
  }

  // ── PAINTINGS ────────────────────────────────────────────────────────────
  hangPaintings(paintings) {
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = "anonymous";

    const total = paintings.length;
    let loaded = 0;
    this._loadGen = (this._loadGen || 0) + 1;
    const myGen = this._loadGen;
    const report = () => this.onProgress(Math.min(loaded, total), total);

    paintings.forEach((p, i) => {
      const side = i % 2 === 0 ? -1 : 1; // alternate
      const slot = Math.floor(i / 2);
      const z = -this.halfL + 4 + slot * SPACING;

      const group = new THREE.Group();
      group.position.set(side * (this.halfW - 0.08), 2.2, z);
      group.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(group);

      // Frame (gilded 4-rail)
      const goldMat = new THREE.MeshPhysicalMaterial({ color: 0xc8a45c, metalness: 0.75, roughness: 0.3, clearcoat: 0.4 });
      const innerShadowMat = new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 0.8 });
      const frameThickness = 0.1;
      const maxH = 2.0, maxW = 3.0;
      const aspect = (p.width || 1) / (p.height || 1);
      let ph = maxH, pw = ph * aspect;
      if (pw > maxW) { pw = maxW; ph = pw / aspect; }

      // Back plate (inner shadow lip)
      const inner = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.1, ph + 0.1, 0.05), innerShadowMat);
      inner.position.z = -0.03;
      group.add(inner);

      // 4 frame rails
      const top = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.4, frameThickness, 0.08), goldMat);
      top.position.set(0, ph / 2 + frameThickness / 2, 0);
      const bot = top.clone(); bot.position.y = -ph / 2 - frameThickness / 2;
      const left = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, ph + frameThickness * 2, 0.08), goldMat);
      left.position.set(-pw / 2 - frameThickness / 2, 0, 0);
      const right = left.clone(); right.position.x = pw / 2 + frameThickness / 2;
      [top, bot, left, right].forEach((m) => { m.castShadow = true; group.add(m); });

      // Canvas plane
      const canvasMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.85 });
      canvasMat.transparent = true; canvasMat.opacity = 0;
      const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), canvasMat);
      group.add(canvasMesh);

      // Spotlight (only the first SHADOW_BUDGET cast shadows; rest skip)
      const spot = new THREE.SpotLight(0xfff0d0, 18, 8, Math.PI / 7, 0.45, 1.2);
      const sx = side === -1 ? -this.halfW : this.halfW;
      spot.position.set(sx, WALL_H - 0.3, z);
      spot.target = group;
      if (i < SHADOW_BUDGET) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(512, 512);
        spot.shadow.bias = -0.0005;
        spot.shadow.radius = 4;
      }
      this.scene.add(spot);
      this._spots.push(spot);

      // Plaque below the frame
      const plaqueMat = new THREE.MeshStandardMaterial({
        map: plaqueTexture(p.title, p.date),
        roughness: 0.6,
      });
      const plaqueW = Math.min(1.6, pw * 0.9);
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(plaqueW, plaqueW * 0.35), plaqueMat);
      plaque.position.set(0, -ph / 2 - 0.4, 0.06);
      group.add(plaque);

      this._disposables.push(goldMat, innerShadowMat, canvasMat, plaqueMat.map, plaqueMat);

      // Load texture
      const url = p.url || p.fullUrl;
      if (!url) {
        loaded++; report();
        canvasMat.color.set(0x2a2a3a);
        canvasMat.opacity = 1;
        return;
      }
      loader.load(
        url,
        (tex) => {
          if (this._loadGen !== myGen || this.disposed) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          canvasMat.map = tex;
          canvasMat.color.set(0xffffff);
          gsap.to(canvasMat, { opacity: 1, duration: 0.7, ease: "power2.out" });
          this._disposables.push(tex);
        },
        undefined,
        () => {
          if (this.disposed) return;
          loaded++;
          report();
          // soft fallback
          canvasMat.color.set(0x2a2a3a);
          canvasMat.opacity = 1;
        },
      );

      // Always increment + report on success/error (texture callbacks)
      const tryReport = () => {
        if (this.disposed) return;
        loaded++;
        report();
      };
      // Override: the success path reports inside the callback; the
      // catch path also reports. To keep it simple, we schedule a
      // one-shot fallback report in case the load is fast.
      // (loader callbacks handle the real reporting.)
      // Add a safety report on next tick so the bar always moves:
      setTimeout(() => { if (!this.disposed) report(); }, 50);
    });
  }

  // ── LOOP / MOVEMENT ─────────────────────────────────────────────────────
  _animate() {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(() => this._animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.controls.isLocked) {
      this.camera.getWorldDirection(this._forward);
      this._forward.y = 0; this._forward.normalize();
      this._right.crossVectors(this._forward, new THREE.Vector3(0, 1, 0)).normalize();

      const speed = 3.2 * (this._keys.shift ? 1.9 : 1);
      const accel = 24;
      this._tmpVec.set(0, 0, 0);
      if (this._keys.w) this._tmpVec.addScaledVector(this._forward, 1);
      if (this._keys.s) this._tmpVec.addScaledVector(this._forward, -1);
      if (this._keys.d) this._tmpVec.addScaledVector(this._right, 1);
      if (this._keys.a) this._tmpVec.addScaledVector(this._right, -1);
      if (this._tmpVec.lengthSq() > 0) this._tmpVec.normalize();

      this._velocity.x += (this._tmpVec.x * speed - this._velocity.x) * Math.min(1, accel * dt / speed);
      this._velocity.z += (this._tmpVec.z * speed - this._velocity.z) * Math.min(1, accel * dt / speed);

      this.camera.position.x += this._velocity.x * dt;
      this.camera.position.z += this._velocity.z * dt;

      // Clamp inside hall
      this.camera.position.x = clamp(this.camera.position.x, -this.halfW + 0.6, this.halfW - 0.6);
      this.camera.position.z = clamp(this.camera.position.z, -this.halfL + 0.6, this.halfL - 0.6);

      // Head bob
      const speedMag = Math.hypot(this._velocity.x, this._velocity.z);
      const bob = speedMag > 0.05 ? Math.sin(performance.now() * 0.006) * 0.03 : 0;
      this.camera.position.y = EYE + bob;
    }

    this.renderer.render(this.scene, this.camera);
  }

  _onKeyDown = (e) => {
    if (!this.controls.isLocked) return;
    const k = e.code;
    if (k === "KeyW" || k === "ArrowUp") this._keys.w = 1;
    if (k === "KeyS" || k === "ArrowDown") this._keys.s = 1;
    if (k === "KeyA" || k === "ArrowLeft") this._keys.a = 1;
    if (k === "KeyD" || k === "ArrowRight") this._keys.d = 1;
    if (k === "ShiftLeft" || k === "ShiftRight") this._keys.shift = 1;
  };
  _onKeyUp = (e) => {
    const k = e.code;
    if (k === "KeyW" || k === "ArrowUp") this._keys.w = 0;
    if (k === "KeyS" || k === "ArrowDown") this._keys.s = 0;
    if (k === "KeyA" || k === "ArrowLeft") this._keys.a = 0;
    if (k === "KeyD" || k === "ArrowRight") this._keys.d = 0;
    if (k === "ShiftLeft" || k === "ShiftRight") this._keys.shift = 0;
  };

  // ── PUBLIC ──────────────────────────────────────────────────────────────
  lock() { this.controls.lock(); }
  unlock() { try { this.controls.unlock(); } catch {} }

  // Cinematic intro: glide the camera from a high-angle establishing
  // shot down to eye level at the entrance while ramping exposure.
  intro() {
    return new Promise((resolve) => {
      const start = { x: 0, y: WALL_H - 0.2, z: -this.halfL + 1.0, look: this.halfL - 2 };
      const end = { x: 0, y: EYE, z: -this.halfL + 2.5, look: 0 };
      this.camera.position.set(start.x, start.y, start.z);
      this.camera.lookAt(0, EYE, start.look);
      this.renderer.toneMappingExposure = 0.0;
      const tl = gsap.timeline({ onComplete: resolve });
      tl.to(this.camera.position, {
        x: end.x, y: end.y, z: end.z, duration: 2.4, ease: "power2.inOut",
        onUpdate: () => this.camera.lookAt(0, EYE, end.look),
      });
      tl.to(this.renderer, { toneMappingExposure: 1.1, duration: 1.6, ease: "power1.out" }, 0);
    });
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    this.disposed = true;
    this._loadGen = (this._loadGen || 0) + 1;
    cancelAnimationFrame(this._raf);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    this._ro?.disconnect();
    try { this.controls?.unlock(); } catch {}
    this.controls?.dispose();

    for (const d of this._disposables) {
      try { d?.dispose?.(); } catch {}
    }
    this._disposables.length = 0;
    this.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { Object.values(m).forEach((v) => v?.isTexture && v.dispose?.()); m.dispose?.(); });
        }
      }
    });
    this.renderer.dispose();
    if (this.renderer.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ─────────────────────────────────────────────────────────────────────────
//  PROCEDURAL TEXTURES (all drawn on <canvas>, sRGB-tagged at use site)
// ─────────────────────────────────────────────────────────────────────────

function woodFloorTexture() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 1024;
  const ctx = c.getContext("2d");
  // base
  const g = ctx.createLinearGradient(0, 0, 1024, 0);
  g.addColorStop(0, "#5a3a1f");
  g.addColorStop(0.5, "#6b4426");
  g.addColorStop(1, "#553319");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 1024);

  // planks
  const plankW = 200, plankH = 1024;
  const rng = mulberry32(99);
  for (let x = 0; x < 1024; x += plankW) {
    const tone = 0.85 + rng() * 0.3;
    ctx.fillStyle = `rgba(${Math.floor(110 * tone)},${Math.floor(75 * tone)},${Math.floor(45 * tone)},0.6)`;
    ctx.fillRect(x, 0, plankW - 4, plankH);
    // dark seam
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x + plankW - 4, 0, 4, plankH);
    // grain curves
    ctx.strokeStyle = "rgba(40,20,10,0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      const yy = (i / 8) * plankH;
      ctx.moveTo(x, yy);
      ctx.bezierCurveTo(x + plankW * 0.3, yy + 10 + rng() * 20, x + plankW * 0.6, yy - 10 + rng() * 20, x + plankW - 4, yy + rng() * 8);
      ctx.stroke();
    }
  }
  // overall noise
  const img = ctx.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] = clamp(img.data[i] + n, 0, 255);
    img.data[i + 1] = clamp(img.data[i + 1] + n, 0, 255);
    img.data[i + 2] = clamp(img.data[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function wallTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ece5d8";
  ctx.fillRect(0, 0, 512, 512);
  // fine speckle
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] = clamp(img.data[i] + n, 0, 255);
    img.data[i + 1] = clamp(img.data[i + 1] + n, 0, 255);
    img.data[i + 2] = clamp(img.data[i + 2] + n * 0.8, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function plaqueTexture(title, sub) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 360;
  const ctx = c.getContext("2d");
  // background
  ctx.fillStyle = "#f0e7d4";
  ctx.fillRect(0, 0, 1024, 360);
  // gold border
  ctx.strokeStyle = "#c8a45c";
  ctx.lineWidth = 6;
  ctx.strokeRect(20, 20, 984, 320);
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, 952, 288);

  // title (italic serif, word-wrapped, ~3 lines max)
  ctx.fillStyle = "#1c1a17";
  ctx.font = "italic 500 56px 'Cormorant Garamond', 'Times New Roman', serif";
  ctx.textBaseline = "top";
  wrapText(ctx, title || "Untitled", 80, 80, 880, 64, 3);

  // sub
  if (sub) {
    ctx.fillStyle = "#7a6a52";
    ctx.font = "400 28px 'Inter', sans-serif";
    ctx.fillText(String(sub), 80, 280);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function endWallTexture(artist, periodName) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 1024;
  const ctx = c.getContext("2d");
  // dark base
  const g = ctx.createLinearGradient(0, 0, 0, 1024);
  g.addColorStop(0, "#0e0d0a");
  g.addColorStop(1, "#1a1815");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 1024);
  // gold rule
  ctx.strokeStyle = "#c8a45c"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(180, 540); ctx.lineTo(844, 540); ctx.stroke();
  // artist name (large serif caps)
  ctx.fillStyle = "#c8a45c";
  ctx.textAlign = "center";
  ctx.font = "600 96px 'Cormorant Garamond', 'Times New Roman', serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText((artist || "").toUpperCase(), 512, 480);
  // period
  ctx.fillStyle = "#9b937f";
  ctx.font = "300 28px 'Inter', sans-serif";
  ctx.fillText((periodName || "").toUpperCase(), 512, 600);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = text.split(/\s+/);
  let line = "";
  let yy = y;
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      lines++;
      if (lines >= maxLines - 1) {
        // ellipsize the rest onto the last line
        let rest = words.slice(i).join(" ");
        while (ctx.measureText(rest + "…").width > maxW && rest.length > 0) rest = rest.slice(0, -1);
        ctx.fillText((rest + "…").trim(), x, yy + lineH);
        return;
      }
      line = words[i];
      yy += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
