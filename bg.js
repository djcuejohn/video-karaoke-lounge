/* ============================================================
   DJCUEJOHN VideoKaraoke-Lounge — animated purple neon background
   Self-contained: draws on <canvas id="neon-bg"> and touches
   nothing in app.js. Layers (back to front):
     1. glowing purple/violet/magenta aurora blobs (drifting)
     2. neon perspective grid floor (scrolling toward the viewer)
     3. twinkling star particles
   Respects prefers-reduced-motion and pauses when the tab is hidden.
   ============================================================ */
(function () {
  const canvas = document.getElementById("neon-bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dpr = 1;
  let running = true;

  // ---- Tweak these to taste ----
  const BLOBS = [
    { hue: 275, r: 0.55, sx: 0.00007, sy: 0.00009, px: 0.0, py: 1.3, a: 0.30 }, // violet
    { hue: 300, r: 0.45, sx: 0.00010, sy: 0.00006, px: 2.1, py: 0.4, a: 0.22 }, // magenta
    { hue: 255, r: 0.60, sx: 0.00006, sy: 0.00008, px: 4.0, py: 2.6, a: 0.26 }, // indigo
    { hue: 285, r: 0.35, sx: 0.00012, sy: 0.00011, px: 5.2, py: 3.7, a: 0.20 }  // bright purple
  ];
  const STAR_COUNT_BASE = 90;   // scaled by screen area
  const GRID_COLOR = "hsla(285, 100%, 68%, ";
  const GRID_SPEED = 0.00035;   // floor scroll speed

  let stars = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.round(STAR_COUNT_BASE * Math.min(1.6, (w * h) / (1280 * 720)));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.4 + 0.3,
      tw: Math.random() * Math.PI * 2,
      sp: Math.random() * 0.002 + 0.0006,
      hue: 260 + Math.random() * 50
    }));
    if (reduceMotion) draw(0); // render one static frame
  }

  function drawBlobs(t) {
    ctx.globalCompositeOperation = "lighter";
    const base = Math.max(w, h);
    for (const b of BLOBS) {
      const x = w * (0.5 + 0.38 * Math.sin(t * b.sx + b.px));
      const y = h * (0.5 + 0.34 * Math.cos(t * b.sy + b.py));
      const r = base * b.r;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${b.hue}, 100%, 60%, ${b.a})`);
      g.addColorStop(0.5, `hsla(${b.hue}, 100%, 45%, ${b.a * 0.35})`);
      g.addColorStop(1, `hsla(${b.hue}, 100%, 40%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawGrid(t) {
    const horizon = h * 0.62;
    const floorH = h - horizon;
    const vx = w / 2;

    // soft glow on the floor, fading in from the horizon
    const fade = ctx.createLinearGradient(0, horizon, 0, h);
    fade.addColorStop(0, "rgba(180, 60, 255, 0)");
    fade.addColorStop(1, "rgba(180, 60, 255, 0.10)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, horizon, w, floorH);

    ctx.lineWidth = 1;
    ctx.shadowColor = "hsla(285, 100%, 65%, 0.9)";
    ctx.shadowBlur = 8;

    // horizontal lines: perspective spacing, scrolling toward the viewer
    const rows = 14;
    const phase = (t * GRID_SPEED) % 1;
    for (let i = 0; i < rows; i++) {
      const p = (i + phase) / rows;          // 0..1 (horizon -> bottom)
      const y = horizon + floorH * Math.pow(p, 2.2);
      ctx.strokeStyle = GRID_COLOR + (0.05 + 0.4 * p) + ")";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // vertical lines fanning out from the vanishing point
    const cols = 22;
    for (let i = -cols; i <= cols; i++) {
      const xBottom = vx + i * (w / cols) * 0.9;
      ctx.strokeStyle = GRID_COLOR + (0.28 - (Math.abs(i) / cols) * 0.16) + ")";
      ctx.beginPath();
      ctx.moveTo(vx + i * 4, horizon);
      ctx.lineTo(xBottom, h);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  function drawStars(t) {
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.tw);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${s.hue}, 100%, 85%, ${0.15 + 0.7 * tw})`;
      ctx.shadowColor = `hsla(${s.hue}, 100%, 70%, 0.9)`;
      ctx.shadowBlur = 6;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function draw(t) {
    // deep violet-black base
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#07030f");
    bg.addColorStop(1, "#12061f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    drawBlobs(t);
    drawGrid(t);
    drawStars(t);
  }

  function frame(now) {
    if (!running) return;
    draw(now);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (reduceMotion) return;
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });

  resize();
  if (!reduceMotion) requestAnimationFrame(frame);
})();
