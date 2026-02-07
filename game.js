// Flappy Face: Insta-like face crop (drag/zoom/rotate) + camera + required face + fists as obstacles

// ---------------------- Game Setup ----------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Config
const GRAVITY = 0.25;
const FLAP = -6;
const PIPE_SPEED = 1.4;
const PIPE_WIDTH = 76;          // pipe width
const GAP = 250;                // slightly larger opening
const PIPE_SPAWN_BASE_MS = 2500;
const PIPE_SPAWN_JITTER_MS = 400;
const INVINCIBLE_MS = 1200;
const MAX_DT_MS = 32;

let state = "start"; // "start" | "playing" | "gameover"
let paused = false;
let score = 0;
let best = Number(localStorage.getItem("bestScore") || 0);
let invincibleUntil = 0;
let lastTime = 0;
let flapTime = 0;

// ---------------------- Sound ----------------------
let audioCtx = null;
const SOUND_STORAGE_KEY = "flappySoundOn";
let audioEnabled = (localStorage.getItem(SOUND_STORAGE_KEY) ?? "true") === "true";
const soundToggleBtn = document.getElementById("soundToggle");
const pauseToggleBtn = document.getElementById("pauseToggle");

function ensureAudio() {
  if (!audioEnabled) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playTone({ freq = 440, dur = 0.12, type = "sine", gain = 0.12 }) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function sfxFlap() {
  playTone({ freq: 600, dur: 0.09, type: "square", gain: 0.08 });
}

function sfxScore() {
  playTone({ freq: 880, dur: 0.08, type: "triangle", gain: 0.07 });
  setTimeout(() => playTone({ freq: 1040, dur: 0.08, type: "triangle", gain: 0.06 }), 60);
}

function sfxGameOver() {
  playTone({ freq: 220, dur: 0.2, type: "sawtooth", gain: 0.1 });
  setTimeout(() => playTone({ freq: 160, dur: 0.25, type: "sawtooth", gain: 0.08 }), 90);
}

function updateSoundButton() {
  if (!soundToggleBtn) return;
  soundToggleBtn.textContent = audioEnabled ? "Sound: On" : "Sound: Off";
  soundToggleBtn.setAttribute("aria-pressed", String(audioEnabled));
}

function setAudioEnabled(next) {
  audioEnabled = next;
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, String(audioEnabled));
  } catch {
    // ignore
  }
  updateSoundButton();
  if (!audioCtx) return;
  if (audioEnabled) {
    ensureAudio();
  } else {
    audioCtx.suspend();
  }
}

if (soundToggleBtn) {
  soundToggleBtn.addEventListener("click", () => {
    setAudioEnabled(!audioEnabled);
  });
}
updateSoundButton();

function updatePauseButton() {
  if (!pauseToggleBtn) return;
  pauseToggleBtn.textContent = paused ? "Resume" : "Pause";
  pauseToggleBtn.setAttribute("aria-pressed", String(paused));
}

function togglePause() {
  if (state !== "playing") return;
  paused = !paused;
  updatePauseButton();
}

if (pauseToggleBtn) {
  pauseToggleBtn.addEventListener("click", togglePause);
}
updatePauseButton();

// Bird
const bird = {
  x: 120,
  y: canvas.height / 2,
  r: 32.5, // 65px diameter (visual size)
  vy: 0
};
const COLLISION_RADIUS = Math.round(bird.r * 0.5);

const FACE_STORAGE_KEY = "flappyFacePngV2";
const FACE_LAST_ACTIVE_KEY = "flappyFaceLastActive";
const FACE_TTL_MS = 30 * 60 * 1000;
const FACE_RENDER_SCALE = 2;

// Bird face
let birdFaceBitmap = null;

let pipes = [];
let lastSpawn = 0;
let nextSpawnMs = PIPE_SPAWN_BASE_MS;

// ---------------------- Draw Fist Lookalike (canvas) ----------------------
// We render a fist-like shape directly with canvas primitives so the
// obstacle doesn't depend on an external image. Top obstacles are
// vertically flipped via the `flipY` flag.

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Draw a pipe-style obstacle (green pipe with rim). `flipY` flips vertically
// so the same drawing is used for top and bottom pipes.
function drawPipe(x, y, w, h, flipY) {
  if (h <= 0) return;
  ctx.save();

  if (flipY) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(1, -1);
    ctx.translate(-(x + w / 2), -(y + h / 2));
  }

  // Pipe colors
  const green1 = '#4db24a';
  const green2 = '#2f8b3a';
  const rim = '#173d1f';

  // Body gradient
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, green1);
  grad.addColorStop(1, green2);

  // Draw main pipe body with rounded outer corners
  ctx.fillStyle = grad;
  const corner = Math.min(w * 0.25, 18);
  roundRect(ctx, x, y, w, h, corner);
  ctx.fill();

  // Inner darker band at the inner edge (facing the gap)
  const rimH = Math.min(28, Math.max(12, h * 0.12));
  const rimY = y; // top of the rectangle; flipY will mirror it
  ctx.fillStyle = rim;
  roundRect(ctx, x + w * 0.05, rimY, w * 0.9, rimH, corner * 0.6);
  ctx.fill();

  // subtle inner shadow near the outer edges
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#000';
  roundRect(ctx, x + w * 0.02, y + h * 0.02, w * 0.96, h * 0.16, corner * 0.5);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Outer stroke
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = Math.max(1, Math.floor(w * 0.03));
  roundRect(ctx, x, y, w, h, corner);
  ctx.stroke();

  ctx.restore();
}

// ---------------------- Utils ----------------------
function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---------------------- Background Clouds ----------------------
const clouds = Array.from({ length: 6 }, () => ({
  x: rand(0, canvas.width),
  y: rand(60, canvas.height - 240),
  r: rand(22, 46),
  speed: rand(0.15, 0.4),
  alpha: rand(0.15, 0.3)
}));

function updateClouds(dtScale) {
  for (const c of clouds) {
    c.x -= c.speed * dtScale;
    if (c.x + c.r * 2 < -40) {
      c.x = canvas.width + rand(30, 120);
      c.y = rand(60, canvas.height - 240);
      c.r = rand(22, 46);
      c.speed = rand(0.15, 0.4);
      c.alpha = rand(0.15, 0.3);
    }
  }
}

function drawClouds() {
  ctx.save();
  for (const c of clouds) {
    ctx.globalAlpha = c.alpha;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.arc(c.x + c.r * 0.9, c.y + c.r * 0.1, c.r * 0.75, 0, Math.PI * 2);
    ctx.arc(c.x - c.r * 0.9, c.y + c.r * 0.15, c.r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------- Game Logic ----------------------
function resetGame() {
  bird.y = canvas.height / 2;
  bird.vy = 0;
  pipes = [];
  score = 0;
  lastSpawn = 0;
  invincibleUntil = 0;
  state = "start";
  paused = false;
  updatePauseButton();
}


function hasFace() {
  return !!birdFaceBitmap;
}

function setLastActive() {
  try {
    localStorage.setItem(FACE_LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

function isFaceExpired() {
  const ts = Number(localStorage.getItem(FACE_LAST_ACTIVE_KEY) || 0);
  if (!ts) return true;
  return (Date.now() - ts) > FACE_TTL_MS;
}

function clearStoredFace() {
  try {
    localStorage.removeItem(FACE_STORAGE_KEY);
    localStorage.removeItem(FACE_LAST_ACTIVE_KEY);
  } catch {
    // ignore
  }
  birdFaceBitmap = null;
}

function triggerGameOver() {
  if (state === "gameover") return;
  state = "gameover";
  paused = false;
  updatePauseButton();
  sfxGameOver();
}

function flapOrOpenFacePicker() {
  // Required face mode:
  if (!hasFace()) {
    openFaceSelectModal();
    return;
  }

  ensureAudio();
  setLastActive();

  if (paused) {
    togglePause();
    return;
  }

  if (state === "start") state = "playing";
  if (state === "gameover") {
    resetGame();
    state = "playing";
    invincibleUntil = performance.now() + INVINCIBLE_MS;
  }
  bird.vy = FLAP;
  sfxFlap();
}

// Controls for gameplay
window.addEventListener("keydown", (e) => {
  setLastActive();
  if (e.code === "Space") {
    e.preventDefault();
    flapOrOpenFacePicker();
  }
  if (e.code === "KeyP") {
    e.preventDefault();
    togglePause();
  }
});

canvas.addEventListener("mousedown", (e) => { setLastActive(); flapOrOpenFacePicker(e); });
canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  setLastActive();
  flapOrOpenFacePicker();
}, { passive: false });

// Collision (circle vs rect)
function circleRectCollides(cx, cy, r, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) <= r * r;
}

function spawnPipe() {
  const padding = 60;
  const gapY = rand(padding + GAP / 2, canvas.height - padding - GAP / 2);
  pipes.push({ x: canvas.width + 20, gapY, passed: false });
  nextSpawnMs = PIPE_SPAWN_BASE_MS + rand(-PIPE_SPAWN_JITTER_MS, PIPE_SPAWN_JITTER_MS);
}

function update(t, dtScale) {
  if (state !== "playing" || paused) return;

  bird.vy += GRAVITY * dtScale;
  bird.y += bird.vy * dtScale;

  // ceiling / ground
  if (t > invincibleUntil) {
    if (bird.y - COLLISION_RADIUS < 0 || bird.y + COLLISION_RADIUS > canvas.height) {
      triggerGameOver();
      return;
    }
  }

  // spawn obstacles
  if (t - lastSpawn > nextSpawnMs) {
    spawnPipe();
    lastSpawn = t;
  }

  // move + collide + score
  for (const p of pipes) {
    p.x -= PIPE_SPEED * dtScale;

    const topH = p.gapY - GAP / 2;
    const botY = p.gapY + GAP / 2;
    const botH = canvas.height - botY;

    const topRect = { x: p.x, y: 0, w: PIPE_WIDTH, h: topH };
    const botRect = { x: p.x, y: botY, w: PIPE_WIDTH, h: botH };

    if (
      t > invincibleUntil &&
      (
        circleRectCollides(bird.x, bird.y, COLLISION_RADIUS, topRect.x, topRect.y, topRect.w, topRect.h) ||
        circleRectCollides(bird.x, bird.y, COLLISION_RADIUS, botRect.x, botRect.y, botRect.w, botRect.h)
      )
    ) {
      triggerGameOver();
      return;
    }

    if (!p.passed && p.x + PIPE_WIDTH < bird.x) {
      p.passed = true;
      score += 1;
      sfxScore();
      if (score > best) {
        best = score;
        localStorage.setItem("bestScore", String(best));
      }
    }
  }

  // cleanup
  pipes = pipes.filter(p => p.x + PIPE_WIDTH > -80);
}

function drawBird() {
  const d = bird.r * 2;

  if (birdFaceBitmap) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(birdFaceBitmap, bird.x - bird.r, bird.y - bird.r, d, d);
    ctx.restore();
    return;
  }

  // fallback
  ctx.beginPath();
  ctx.fillStyle = "#ffd54a";
  ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
  ctx.fill();
}

function message(lines) {
  const arr = Array.isArray(lines) ? lines : [lines];
  const boxH = 88;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, canvas.height / 2 - boxH / 2, canvas.width, boxH);

  const maxWidth = canvas.width - 24;
  let size = 12;
  ctx.font = `${size}px "Press Start 2P", system-ui, sans-serif`;
  const widest = () => Math.max(...arr.map(t => ctx.measureText(t).width));
  while (size > 8 && widest() > maxWidth) {
    size -= 1;
    ctx.font = `${size}px "Press Start 2P", system-ui, sans-serif`;
  }

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lineGap = size + 6;
  const startY = canvas.height / 2 - (lineGap * (arr.length - 1)) / 2;
  arr.forEach((t, i) => {
    ctx.fillText(t, canvas.width / 2, startY + i * lineGap);
  });

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawClouds();

  // Draw pipes (obstacles)
  for (const p of pipes) {
    const topH = p.gapY - GAP / 2;
    const botY = p.gapY + GAP / 2;
    const botH = canvas.height - botY;

    // top pipe (flipped)
    drawPipe(p.x, 0, PIPE_WIDTH, topH, true);

    // bottom pipe (normal)
    drawPipe(p.x, botY, PIPE_WIDTH, botH, false);
  }

  drawBird();

  // Score
  ctx.fillStyle = "#0b1220";
  ctx.font = "20px \"Press Start 2P\", system-ui, sans-serif";
  ctx.fillText(String(score), 18, 40);

  ctx.font = "12px \"Press Start 2P\", system-ui, sans-serif";
  ctx.fillText(`best: ${best}`, 18, 62);

  // Required-face message
  if (!hasFace()) {
    message("Upload your face to start");
    return;
  }

  if (paused) {
    message(["Paused", "Click/Tap/Space to Resume"]);
    return;
  }

  if (state === "start") message(["Tap/Click/Space", "to Start"]);
  if (state === "gameover") message(["Game Over", "Tap to Restart"]);
}

// Main loop
resetGame();
function loop(t) {
  const dt = Math.min(t - lastTime, MAX_DT_MS);
  lastTime = t;
  const dtScale = dt / 16.67;

  flapTime += 0.12 * dtScale;
  updateClouds(dtScale);
  update(t, dtScale);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------- Modal + Cropper ----------------------
const fileInput = document.getElementById("fileInput");
const openFaceSelectBtn = document.getElementById("openFaceSelect");
const openCameraFromSelectBtn = document.getElementById("openCameraFromSelect");

const modal = document.getElementById("modal");
const closeModalBtn = document.getElementById("closeModal");
const cancelCropBtn = document.getElementById("cancelCrop");
const useCropBtn = document.getElementById("useCrop");
const resetCropBtn = document.getElementById("resetCrop");
const snapCenterBtn = document.getElementById("snapCenter");

const cropCanvas = document.getElementById("cropCanvas");
const cropCtx = cropCanvas.getContext("2d");
const zoomEl = document.getElementById("zoom");
const rotateEl = document.getElementById("rotate");

const previewCanvas = document.getElementById("previewCanvas");
const previewCtx = previewCanvas.getContext("2d");

// Camera
const cameraBox = document.getElementById("cameraBox");
const cameraVideo = document.getElementById("cameraVideo");
const captureBtn = document.getElementById("captureBtn");
const stopCameraBtn = document.getElementById("stopCameraBtn");
let cameraStream = null;

// Crop image + transform state
let img = null;
let imgLoaded = false;

let scale = Number(zoomEl.value);
let rotation = 0; // radians
let offsetX = 0;
let offsetY = 0;

let dragging = false;
let lastPos = { x: 0, y: 0 };

let gesturing = false;
let startDist = 0;
let startAngle = 0;
let startScale = 1;
let startRotation = 0;

function degToRad(deg) { return (deg * Math.PI) / 180; }
function radToDeg(rad) { return (rad * 180) / Math.PI; }

function openModal() {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  modal.classList.remove("open");
  modal.classList.remove("camera-only");
  modal.setAttribute("aria-hidden", "true");
}

function openModalForFace() {
  stopCamera();
  openModal();
  drawCropper();
}

function getCropCircle() {
  const cw = cropCanvas.width;
  return { cx: cw / 2, cy: cw / 2, r: cw * 0.35 };
}

function resetTransform() {
  zoomEl.value = "1.2";
  rotateEl.value = "0";

  scale = Number(zoomEl.value);
  rotation = 0;
  offsetX = cropCanvas.width / 2;
  offsetY = cropCanvas.height / 2;
}

function snapToCenter() {
  offsetX = cropCanvas.width / 2;
  offsetY = cropCanvas.height / 2;
  drawCropper();
}

function drawCropper() {
  const cw = cropCanvas.width;
  const ch = cropCanvas.height;

  cropCtx.clearRect(0, 0, cw, ch);
  cropCtx.fillStyle = "#0b1220";
  cropCtx.fillRect(0, 0, cw, ch);

  if (imgLoaded) {
    cropCtx.save();
    cropCtx.translate(offsetX, offsetY);
    cropCtx.rotate(rotation);
    cropCtx.scale(scale, scale);
    cropCtx.drawImage(img, -img.width / 2, -img.height / 2);
    cropCtx.restore();
  }

  // Dim outside circle
  const { cx, cy, r } = getCropCircle();
  cropCtx.save();
  cropCtx.fillStyle = "rgba(0,0,0,0.55)";
  cropCtx.beginPath();
  cropCtx.rect(0, 0, cw, ch);
  cropCtx.arc(cx, cy, r, 0, Math.PI * 2, true);
  cropCtx.fill("evenodd");
  cropCtx.restore();

  // Circle border
  cropCtx.save();
  cropCtx.strokeStyle = "rgba(255,255,255,0.9)";
  cropCtx.lineWidth = 3;
  cropCtx.beginPath();
  cropCtx.arc(cx, cy, r, 0, Math.PI * 2);
  cropCtx.stroke();
  cropCtx.restore();

  drawPreview();
}

function renderCircleCropCanvas(outSize) {
  const { cx, cy, r } = getCropCircle();
  const sx = cx - r;
  const sy = cy - r;
  const sSize = r * 2;

  const out = document.createElement("canvas");
  out.width = outSize;
  out.height = outSize;
  const octx = out.getContext("2d");

  octx.save();
  octx.beginPath();
  octx.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2);
  octx.clip();

  octx.drawImage(cropCanvas, sx, sy, sSize, sSize, 0, 0, outSize, outSize);
  octx.restore();

  // outline
  octx.save();
  octx.strokeStyle = "rgba(0,0,0,0.25)";
  octx.lineWidth = 2;
  octx.beginPath();
  octx.arc(outSize / 2, outSize / 2, outSize / 2 - 1, 0, Math.PI * 2);
  octx.stroke();
  octx.restore();

  return out;
}

function upscaleCanvas(canvas, scale) {
  if (scale <= 1) return canvas;
  const out = document.createElement("canvas");
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

function drawPreview() {
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.fillStyle = "rgba(0,0,0,0.25)";
  previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

  if (!imgLoaded) return;
  const out = renderCircleCropCanvas(previewCanvas.width);
  previewCtx.drawImage(out, 0, 0);
}

function clientToCanvasPos(e) {
  const rect = cropCanvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (cx - rect.left) * (cropCanvas.width / rect.width),
    y: (cy - rect.top) * (cropCanvas.height / rect.height)
  };
}

function touchDistance(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}

function touchAngle(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.atan2(dy, dx);
}

// gesture handlers
function onDown(e) {
  if (!imgLoaded) return;

  if (e.touches && e.touches.length === 2) {
    gesturing = true;
    dragging = false;

    startDist = touchDistance(e.touches[0], e.touches[1]);
    startAngle = touchAngle(e.touches[0], e.touches[1]);

    startScale = scale;
    startRotation = rotation;
    return;
  }

  gesturing = false;
  dragging = true;
  lastPos = clientToCanvasPos(e);
}

function onMove(e) {
  if (!imgLoaded) return;

  if (e.touches && e.touches.length === 2 && gesturing) {
    e.preventDefault();

    const dist = touchDistance(e.touches[0], e.touches[1]);
    const angle = touchAngle(e.touches[0], e.touches[1]);

    const ratio = dist / (startDist || dist);
    scale = clamp(startScale * ratio, Number(zoomEl.min), Number(zoomEl.max));

    rotation = startRotation + (angle - startAngle);

    zoomEl.value = String(scale);

    // clamp rotation for slider simplicity
    const deg = clamp(Math.round(radToDeg(rotation)), -180, 180);
    rotateEl.value = String(deg);
    rotation = degToRad(deg);

    drawCropper();
    return;
  }

  if (!dragging) return;
  e.preventDefault();

  const p = clientToCanvasPos(e);
  offsetX += (p.x - lastPos.x);
  offsetY += (p.y - lastPos.y);
  lastPos = p;

  drawCropper();
}

function onUp(e) {
  if (e && e.touches) {
    if (e.touches.length < 2) gesturing = false;
    if (e.touches.length === 0) dragging = false;
  } else {
    dragging = false;
    gesturing = false;
  }
}

cropCanvas.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);

cropCanvas.addEventListener("touchstart", (e) => { e.preventDefault(); onDown(e); }, { passive: false });
cropCanvas.addEventListener("touchmove", (e) => { onMove(e); }, { passive: false });
cropCanvas.addEventListener("touchend", (e) => { onUp(e); }, { passive: false });
cropCanvas.addEventListener("touchcancel", (e) => { onUp(e); }, { passive: false });

zoomEl.addEventListener("input", () => {
  scale = Number(zoomEl.value);
  drawCropper();
});

rotateEl.addEventListener("input", () => {
  rotation = degToRad(Number(rotateEl.value));
  drawCropper();
});

resetCropBtn.addEventListener("click", () => {
  resetTransform();
  drawCropper();
});

snapCenterBtn.addEventListener("click", snapToCenter);

closeModalBtn.addEventListener("click", () => {
  closeModal();
  stopCamera();
});

cancelCropBtn.addEventListener("click", () => {
  closeModal();
  stopCamera();
});

modal.addEventListener("mousedown", (e) => {
  if (e.target === modal) {
    closeModal();
    stopCamera();
  }
});

// Load image from file
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = url;
  });
}

async function setCropImage(newImg) {
  img = newImg;
  imgLoaded = true;

  resetTransform();
  snapToCenter();
  drawCropper();
}

if (fileInput) {
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
  
    try {
      const image = await loadImageFromFile(file);
      cameraBox.hidden = true;
      await setCropImage(image);
      openModal();
    } catch {
      alert("Sorry — that image couldn't be loaded. Try another one.");
    } finally {
      fileInput.value = "";
    }
  });
}

// ---------------------- Camera ----------------------
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });

    cameraVideo.srcObject = cameraStream;
    cameraBox.hidden = false;
    modal.classList.add("camera-only");
    openModal();
  } catch {
    alert("Camera not available or permission denied. Use Upload face instead.");
  }
}

function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach(t => t.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  cameraBox.hidden = true;
}

if (openFaceSelectBtn) {
  openFaceSelectBtn.addEventListener("click", openFaceSelectModal);
}

if (openCameraFromSelectBtn) {
  openCameraFromSelectBtn.addEventListener("click", () => {
    closeFaceSelectModal();
    startCamera();
  });
}
if (stopCameraBtn) {
  stopCameraBtn.addEventListener("click", stopCamera);
}

captureBtn.addEventListener("click", async () => {
  if (!cameraStream) return;

  const w = cameraVideo.videoWidth || 640;
  const h = cameraVideo.videoHeight || 480;

  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;

  const tctx = tmp.getContext("2d");
  tctx.drawImage(cameraVideo, 0, 0, w, h);

  stopCamera();
  modal.classList.remove("camera-only");

  const dataUrl = tmp.toDataURL("image/png");
  const captured = new Image();
  captured.src = dataUrl;
  await new Promise(res => (captured.onload = res));

  await setCropImage(captured);
  drawCropper();
});

// ---------------------- Save face + set bird sprite ----------------------
async function setBirdFaceFromCanvas(outCanvas) {
  const dataUrl = outCanvas.toDataURL("image/png");
  try {
    localStorage.setItem(FACE_STORAGE_KEY, dataUrl);
    localStorage.setItem(FACE_LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    // ignore (still works this session)
  }

  if ("createImageBitmap" in window) {
    birdFaceBitmap = await createImageBitmap(outCanvas);
    return;
  }

  const tempImg = new Image();
  tempImg.src = dataUrl;
  await new Promise(res => (tempImg.onload = res));
  birdFaceBitmap = tempImg;
}

useCropBtn.addEventListener("click", async () => {
  if (!imgLoaded) {
    alert("Upload a photo or use camera first.");
    return;
  }

  const outCanvas = renderCircleCropCanvas(bird.r * 2 * FACE_RENDER_SCALE);
  await setBirdFaceFromCanvas(outCanvas);
  closeModal();

  if (state === "start") {
    setTimeout(() => {
      state = "playing";
    }, 2000);
  }
});

// ---------------------- Face Selection Modal ----------------------
const faceSelectModal = document.getElementById("faceSelectModal");
const closeFaceSelectModalBtn = document.getElementById("closeFaceSelectModal");
const selectBirdFaceBtn = document.getElementById("selectBirdFace");
const selectChickenFaceBtn = document.getElementById("selectChickenFace");
const selectFishFaceBtn = document.getElementById("selectFishFace");
const selectDinoFaceBtn = document.getElementById("selectDinoFace");
const fileInput2 = document.getElementById("fileInput2");

function openFaceSelectModal() {
  faceSelectModal.classList.add("open");
  faceSelectModal.setAttribute("aria-hidden", "false");
  drawPreMadeFaces();
}

function closeFaceSelectModal() {
  faceSelectModal.classList.remove("open");
  faceSelectModal.setAttribute("aria-hidden", "true");
}

function drawPreMadeFaces() {
  // Draw bird face
  const birdCanvas = document.getElementById("birdFaceCanvas");
  const birdCtx = birdCanvas.getContext("2d");
  birdCtx.clearRect(0, 0, birdCanvas.width, birdCanvas.height);
  
  // Yellow circle for bird body
  birdCtx.fillStyle = "#ffd54a";
  birdCtx.beginPath();
  birdCtx.arc(60, 60, 45, 0, Math.PI * 2);
  birdCtx.fill();
  
  // Left eye
  birdCtx.fillStyle = "#000";
  birdCtx.beginPath();
  birdCtx.arc(45, 50, 8, 0, Math.PI * 2);
  birdCtx.fill();
  
  // Right eye
  birdCtx.beginPath();
  birdCtx.arc(75, 50, 8, 0, Math.PI * 2);
  birdCtx.fill();
  
  // Beak
  birdCtx.fillStyle = "#ff9500";
  birdCtx.beginPath();
  birdCtx.moveTo(85, 60);
  birdCtx.lineTo(105, 55);
  birdCtx.lineTo(105, 65);
  birdCtx.closePath();
  birdCtx.fill();

  // Draw chicken face
  const chickenCanvas = document.getElementById("chickenFaceCanvas");
  const chickenCtx = chickenCanvas.getContext("2d");
  chickenCtx.clearRect(0, 0, chickenCanvas.width, chickenCanvas.height);
  
  // Brown circle for chicken body
  chickenCtx.fillStyle = "#cd7f32";
  chickenCtx.beginPath();
  chickenCtx.arc(60, 65, 40, 0, Math.PI * 2);
  chickenCtx.fill();
  
  // Left eye
  chickenCtx.fillStyle = "#000";
  chickenCtx.beginPath();
  chickenCtx.arc(50, 55, 7, 0, Math.PI * 2);
  chickenCtx.fill();
  
  // Right eye
  chickenCtx.beginPath();
  chickenCtx.arc(70, 55, 7, 0, Math.PI * 2);
  chickenCtx.fill();
  
  // Red comb on top
  chickenCtx.fillStyle = "#ff4444";
  chickenCtx.beginPath();
  chickenCtx.moveTo(50, 20);
  chickenCtx.lineTo(55, 35);
  chickenCtx.lineTo(65, 30);
  chickenCtx.lineTo(70, 20);
  chickenCtx.closePath();
  chickenCtx.fill();
  
  // Yellow beak
  chickenCtx.fillStyle = "#ffa500";
  chickenCtx.beginPath();
  chickenCtx.moveTo(75, 65);
  chickenCtx.lineTo(95, 60);
  chickenCtx.lineTo(95, 70);
  chickenCtx.closePath();
  chickenCtx.fill();

  // Draw fish face
  const fishCanvas = document.getElementById("fishFaceCanvas");
  const fishCtx = fishCanvas.getContext("2d");
  fishCtx.clearRect(0, 0, fishCanvas.width, fishCanvas.height);

  // Fish body
  fishCtx.fillStyle = "#5bc0eb";
  fishCtx.beginPath();
  fishCtx.ellipse(60, 65, 45, 30, 0, 0, Math.PI * 2);
  fishCtx.fill();

  // Tail
  fishCtx.fillStyle = "#2f8ab8";
  fishCtx.beginPath();
  fishCtx.moveTo(15, 65);
  fishCtx.lineTo(0, 50);
  fishCtx.lineTo(0, 80);
  fishCtx.closePath();
  fishCtx.fill();

  // Eye
  fishCtx.fillStyle = "#000";
  fishCtx.beginPath();
  fishCtx.arc(80, 60, 6, 0, Math.PI * 2);
  fishCtx.fill();

  // Draw dino face
  const dinoCanvas = document.getElementById("dinoFaceCanvas");
  const dinoCtx = dinoCanvas.getContext("2d");
  dinoCtx.clearRect(0, 0, dinoCanvas.width, dinoCanvas.height);

  // Dino head
  dinoCtx.fillStyle = "#4caf50";
  dinoCtx.beginPath();
  dinoCtx.arc(60, 65, 40, 0, Math.PI * 2);
  dinoCtx.fill();

  // Dino spikes
  dinoCtx.fillStyle = "#2e7d32";
  dinoCtx.beginPath();
  dinoCtx.moveTo(35, 20);
  dinoCtx.lineTo(45, 40);
  dinoCtx.lineTo(25, 40);
  dinoCtx.closePath();
  dinoCtx.fill();
  dinoCtx.beginPath();
  dinoCtx.moveTo(55, 15);
  dinoCtx.lineTo(65, 38);
  dinoCtx.lineTo(45, 38);
  dinoCtx.closePath();
  dinoCtx.fill();

  // Eye
  dinoCtx.fillStyle = "#000";
  dinoCtx.beginPath();
  dinoCtx.arc(70, 60, 6, 0, Math.PI * 2);
  dinoCtx.fill();
}

// Create pre-made face from canvas
async function usePreMadeFace(canvas) {
  const hiResCanvas = upscaleCanvas(canvas, FACE_RENDER_SCALE);
  const dataUrl = hiResCanvas.toDataURL("image/png");
  try {
    localStorage.setItem(FACE_STORAGE_KEY, dataUrl);
    localStorage.setItem(FACE_LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    // ignore
  }

  if ("createImageBitmap" in window) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      birdFaceBitmap = await createImageBitmap(blob);
    } catch {
      const imgEl = new Image();
      imgEl.src = dataUrl;
      await new Promise(res => (imgEl.onload = res));
      birdFaceBitmap = imgEl;
    }
  } else {
    const imgEl = new Image();
    imgEl.src = dataUrl;
    await new Promise(res => (imgEl.onload = res));
    birdFaceBitmap = imgEl;
  }

  closeFaceSelectModal();
  if (state === "start") {
    setTimeout(() => {
      state = "playing";
    }, 2000);
  }
}

selectBirdFaceBtn.addEventListener("click", () => {
  const canvas = document.getElementById("birdFaceCanvas");
  usePreMadeFace(canvas);
});

selectChickenFaceBtn.addEventListener("click", () => {
  const canvas = document.getElementById("chickenFaceCanvas");
  usePreMadeFace(canvas);
});

selectFishFaceBtn.addEventListener("click", () => {
  const canvas = document.getElementById("fishFaceCanvas");
  usePreMadeFace(canvas);
});

selectDinoFaceBtn.addEventListener("click", () => {
  const canvas = document.getElementById("dinoFaceCanvas");
  usePreMadeFace(canvas);
});

closeFaceSelectModalBtn.addEventListener("click", closeFaceSelectModal);

faceSelectModal.addEventListener("mousedown", (e) => {
  if (e.target === faceSelectModal) {
    closeFaceSelectModal();
  }
});

// Upload from file input 2
fileInput2.addEventListener("change", async () => {
  const file = fileInput2.files && fileInput2.files[0];
  if (!file) return;

  try {
    const image = await loadImageFromFile(file);
    await setCropImage(image);
    openModal();
    closeFaceSelectModal();
  } catch {
    alert("Sorry — that image couldn't be loaded. Try another one.");
  } finally {
    fileInput2.value = "";
  }
});

// Load saved face on refresh
async function loadSavedFace() {
  const dataUrl = localStorage.getItem(FACE_STORAGE_KEY);
  if (!dataUrl) return;
  if (isFaceExpired()) {
    clearStoredFace();
    return;
  }

  try {
    if ("createImageBitmap" in window) {
      // Convert data URL to blob properly
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      birdFaceBitmap = await createImageBitmap(blob);
      return;
    }

    const imgEl = new Image();
    imgEl.src = dataUrl;
    await new Promise(res => (imgEl.onload = res));
    birdFaceBitmap = imgEl;
  } catch (err) {
    console.warn("Could not load saved face:", err);
    // Fallback: try with regular Image element
    try {
      const imgEl = new Image();
      imgEl.src = dataUrl;
      await new Promise(res => (imgEl.onload = res));
      birdFaceBitmap = imgEl;
    } catch {
      // ignore
    }
  }
}
loadSavedFace();
drawCropper();

// Auto-expire saved face after inactivity
setInterval(() => {
  if (isFaceExpired()) {
    clearStoredFace();
  }
}, 60 * 1000);
