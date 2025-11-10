// script.js
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9";
import { drawGame } from './modules/draw.js';
import { loadScores, renderScores, commitName, resetScores, checkHighScore } from './modules/scoreboard.js';

//////////////////////
// Config constants //
//////////////////////
const PLAYER_W = 20;
const PLAYER_H = 20;
const GRAVITY = 0.6;
const JUMP_FORCE = -10;
const SCROLL_SPEED = 2.5;
const SHIELD_DURATION = 3.0; // seconds
const POWERUP_DURATION = 5.0; // seconds for star (invincibility)
// per-type spawn chances (chance per frame)
// Stars (invincibility) should be very rare
const POWERUP_SPAWN_CHANCE_STAR = 0.0005;
// Wings should be more common
const POWERUP_SPAWN_CHANCE_WINGS = 0.0025;
// Jumping shoe is somewhat common too
const POWERUP_SPAWN_CHANCE_SHOE = 0.0025;
// helper: overall spawn envelope max per frame (optional safety cap)
const POWERUP_SPAWN_CAP = 0.1; // max powerups spawn per frame
// Freeze-gun spawn chance (blue gun)
const POWERUP_SPAWN_CHANCE_FREEZE = 0.0012;
// Red-cross (one-time collision) spawn chance
const POWERUP_SPAWN_CHANCE_REDCROSS = 0.0018;
// jumping shoe modifiers
const SHOES_JUMP_MULT = 1.45; // 45% higher jump
const SHOES_GRAVITY_MULT = 0.75; // slightly reduced gravity for longer airtime
// duration specifically for shoe powerup (seconds)
const SHOES_DURATION = 3.0; // shorter than general POWERUP_DURATION
// explicit wings duration (can be tuned separately)
const WINGS_DURATION = 3.0; // default to the general powerup duration
// freeze-gun behavior
const FREEZE_DURATION = 3.0; // how long an enemy stays frozen
const FREEZE_BEAM_INTERVAL = 0.45; // seconds between auto-shots when freeze-gun active
const FREEZE_BEAM_SPEED = 420; // px / second
const FREEZE_GUN_DURATION = 5.0; // how long the freeze-gun powerup lasts
// red-cross behavior
const REDCROSS_DURATION = 30.0; // how long the red-cross lasts if unused
// rainbow visual speeds (tweak to change color cycling & pulsing)
const RAINBOW_HUE_SPEED = 900; // smaller = faster hue cycle (ms per cycle divisor)
const RAINBOW_PULSE_SPEED = 75; // smaller = faster pulse
const GAP_MAX_WIDTH_MULT = 3; // max gap = 3 * player width
const GAP_MIN_SPACING_MULT = 2; // min spacing between gaps = 2 * player width

// visual indicator config
const INDICATOR_X_CENTER = null; // computed from canvas
const INDICATOR_BASELINE_Y = 40; // fixed baseline Y (px from top)
const INDICATOR_SCALE = 300; // scale factor for mapping nose delta to visual - tweak if needed
const JUMP_NOSE_THRESHOLD = 0.02; // noseRise threshold used for jump (positive = nose moved up relative to baseline)

//////////////////////
// State variables  //
//////////////////////
let video, faceLandmarker;
let baselineNoseY = null;
let wasMouthOpen = false;
let jumpCooldown = false;
// Debug invincibility flag
let debugInvincible = false;

let canvas, ctx;
let player, ground, obstacles, gaps, score, gameOver, lastFrameTime;
let shieldActive = false;
let shieldTimeLeft = 0;
// generic power-up state (for star invincibility)
let powerUpActive = false;
let powerUpTimeLeft = 0;
// wings powerup state
let wingsActive = false;
let wingsTimeLeft = 0;
// shoe powerup state
let shoeActive = false;
let shoeTimeLeft = 0;
// freeze-gun state
let freezeGunActive = false;
let freezeGunTimeLeft = 0;
let freezeFireCooldown = 0;
let beams = [];
let particles = [];
// red-cross one-time hit state
let redCrossActive = false;
let redCrossTimeLeft = 0;
let powerUps = [];
let action = "😐 Idle";

// For visual nose dot
let lastNoseY = null;
let noseVisualOffset = 0;

//////////////////////
// Initialization   //
//////////////////////
async function init() {
  console.log('[game] init start');
  canvas = document.getElementById("gameCanvas");
  ctx = canvas.getContext("2d");

  // store internal resolution to draw at fixed logical size while CSS-resizing for responsiveness
  const LOGICAL_WIDTH = 400;
  const LOGICAL_HEIGHT = 300;
  canvas.width = LOGICAL_WIDTH;
  canvas.height = LOGICAL_HEIGHT;

  // make canvas scale to CSS size while preserving internal resolution
  function resizeCanvasToDisplaySize() {
    const rect = canvas.getBoundingClientRect();
    // If CSS size differs from internal resolution, scale drawing via transform
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    // recompute ground based on logical height in case layout changed
    ground = canvas.height - 40;
    // keep player y anchored to ground if on ground
    if (player && player.onGround) player.y = ground - player.h;
  }

  // call once and on window resize
  window.addEventListener('resize', () => {
    // allow browser to recalc layout then adjust transform
    requestAnimationFrame(resizeCanvasToDisplaySize);
  });
  requestAnimationFrame(resizeCanvasToDisplaySize);

  // initialize video element
  video = document.getElementById("webcam");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    video.srcObject = stream;
  } catch (e) {
    document.getElementById("status").textContent = "Camera access required.";
    console.error("getUserMedia error:", e);
    return;
  }

  // Wait until video has a real frame size
  await new Promise((res) => {
    video.onloadedmetadata = () => {
      video.play();
      const iv = setInterval(() => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          clearInterval(iv);
          res();
        }
      }, 100);
    };
  });

  // Load MediaPipe face landmarker
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-assets/face_landmarker.task"
    },
    outputFaceBlendshapes: false, // we only need landmarks
    runningMode: "VIDEO",
    numFaces: 1
  });

  // Initialize game state and start loops
  resetGame();
  console.log('[game] reset done, starting loops');

  // wire debug toggle if present
  const dbgToggle = document.getElementById('debugToggle');
  if (dbgToggle) {
    dbgToggle.checked = debugInvincible;
    dbgToggle.addEventListener('change', (e) => {
      debugInvincible = !!e.target.checked;
      document.getElementById('status').textContent = debugInvincible ? 'DEBUG: Invincible | Ready' : 'Ready';
    });
  }
  detectLoop();
  requestAnimationFrame(gameLoop);
}

//////////////////////
// Reset / TryAgain //
//////////////////////
function resetGame() {
  player = { x: 50, y: 240, w: PLAYER_W, h: PLAYER_H, vy: 0, onGround: true };
  // recompute ground using logical canvas height
  ground = canvas.height - 40;
  obstacles = [];
  gaps = [];
  powerUps = [];
  score = 0;
  gameOver = false;
  baselineNoseY = null;
  wasMouthOpen = false;
  jumpCooldown = false;
  shieldActive = false;
  shieldTimeLeft = 0;
  powerUpActive = false;
  powerUpTimeLeft = 0;
  wingsActive = false;
  wingsTimeLeft = 0;
  shoeActive = false;
  shoeTimeLeft = 0;
  action = "😐 Idle";
  lastFrameTime = performance.now();
  lastNoseY = null;
  noseVisualOffset = 0;
  document.getElementById("tryAgain").style.display = "none";
  document.getElementById("status").textContent = "Ready";
  document.getElementById("debug").innerHTML = "Debug info will appear here";
}

// Ensure Try Again restarts detection & game loops
document.getElementById("tryAgain").addEventListener("click", () => {
  resetGame();
  // restart loops
  detectLoop();
  requestAnimationFrame(gameLoop);
});

//////////////////////
// Face detection   //
//////////////////////
async function detectLoop() {
  if (!faceLandmarker) return;

  try {
    const results = await faceLandmarker.detectForVideo(video, performance.now());

    if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
      const lm = results.faceLandmarks[0];
      const nose = lm[1]; // nose tip
      const upperLip = lm[13];
      const lowerLip = lm[14];

      // mouth metric
      const mouthOpenAmount = lowerLip.y - upperLip.y;
      const mouthOpen = mouthOpenAmount > 0.03;

      // baseline init
      if (!baselineNoseY) baselineNoseY = nose.y;

      // noseRise positive when head tips back (nose moves up on screen coordinates: smaller y => up; baseline - current)
      const noseRise = baselineNoseY - nose.y;

      // visual nose offset mapping: map noseRise (small decimals) to a visual px offset
      noseVisualOffset = -noseRise * INDICATOR_SCALE; // negative because rise -> move up visually

      // shield: rising edge detection (start shield only when mouth opens newly and shield depleted)
      if (mouthOpen && !wasMouthOpen && !shieldActive && shieldTimeLeft <= 0) {
        shieldActive = true;
        shieldTimeLeft = SHIELD_DURATION;
        action = "🛡️ Shield Up!";
      }
      wasMouthOpen = mouthOpen;

      // jump trigger (noseRise > threshold) with cooldown and requiring onGround in jump function
      if (noseRise > JUMP_NOSE_THRESHOLD && !jumpCooldown) {
        doJump(); // sets cooldown
        if (!shieldActive) action = "🦘 Jump!";
      }

      // update debug panel numerics (include power-up info)
      document.getElementById("debug").innerHTML = `
        Nose Y: ${nose.y.toFixed(3)}<br>
        Baseline Nose Y: ${baselineNoseY.toFixed(3)}<br>
        Nose Rise: ${noseRise.toFixed(3)}<br>
        Mouth Open Amount: ${mouthOpenAmount.toFixed(3)}<br>
        Invincible: ${debugInvincible}<br>
        wasMouthOpen: ${wasMouthOpen}<br>
        shieldActive: ${shieldActive}<br>
        shieldTimeLeft: ${shieldTimeLeft.toFixed(2)}s<br>
        powerUpActive: ${powerUpActive}<br>
        powerUpTimeLeft: ${powerUpTimeLeft.toFixed(2)}s<br>
        activePowerUpsOnField: ${powerUps.filter(p=>!p.collected).length}<br>
        jumpCooldown: ${jumpCooldown}
      `;
    }
  } catch (err) {
    console.warn("detectLoop error", err);
  }

  if (!gameOver) requestAnimationFrame(detectLoop);
}

function doJump() {
  if (player.onGround) {
    // apply shoe multiplier if active
    const jumpForce = shoeActive ? JUMP_FORCE * SHOES_JUMP_MULT : JUMP_FORCE;
    player.vy = jumpForce;
    player.onGround = false;
  }
  jumpCooldown = true;
  setTimeout(() => (jumpCooldown = false), 800);
}

//////////////////////
// Level spawn utils//
//////////////////////
function spawnObstacleAt(x) {
  // make skeleton obstacles taller so they have bodies — base 20x32
  const w = 20, h = 32;
  const overlapsGap = gaps.some(g => !(x + w <= g.x || x >= g.x + g.w));
  if (!overlapsGap) {
    // give each obstacle a phase for animation (walking cycle) and slight random offset
    obstacles.push({ x, y: ground - h, w, h, phase: Math.random() * Math.PI * 2 });
  }
}

function spawnGapIfAllowed() {
  const maxGapW = PLAYER_W * GAP_MAX_WIDTH_MULT;
  const minGapW = PLAYER_W;
  const gapW = minGapW + Math.floor(Math.random() * (maxGapW - minGapW + 1));

  const lastGap = gaps.length ? gaps[gaps.length - 1] : null;
  const minSpacing = PLAYER_W * GAP_MIN_SPACING_MULT;

  if (lastGap) {
    const lastGapRight = lastGap.x + lastGap.w;
    if (lastGapRight > canvas.width - minSpacing) {
      return;
    }
  }

  // push new gap at the right edge
  gaps.push({ x: canvas.width, w: gapW });
}

//////////////////////
// Game update loop //
//////////////////////
function gameLoop(timestamp) {
  const delta = (timestamp - lastFrameTime) / 1000;
  lastFrameTime = timestamp;

  if (!gameOver) {
    updateGame(delta);
    drawGame({
      ctx, canvas, ground, gaps, obstacles, powerUps, beams, particles, player,
      powerUpActive, powerUpTimeLeft, POWERUP_DURATION,
      shieldActive, shieldTimeLeft, SHIELD_DURATION,
      wingsActive, shoeActive, redCrossActive,
      noseVisualOffset, INDICATOR_BASELINE_Y, INDICATOR_SCALE,
      JUMP_NOSE_THRESHOLD, RAINBOW_HUE_SPEED, RAINBOW_PULSE_SPEED,
      score
    });
    requestAnimationFrame(gameLoop);
  }
}

function updateGame(dt) {
  // shield drains while active
  if (shieldActive) {
    shieldTimeLeft -= dt;
    if (shieldTimeLeft <= 0) {
      shieldTimeLeft = 0;
      shieldActive = false;
    }
  }

  // power-up timer
  if (powerUpActive) {
    powerUpTimeLeft -= dt;
    if (powerUpTimeLeft <= 0) {
      powerUpTimeLeft = 0;
      powerUpActive = false;
      action = "😐 Idle";
    }
  }
  // wings timer
  if (wingsActive) {
    wingsTimeLeft -= dt;
    if (wingsTimeLeft <= 0) {
      wingsTimeLeft = 0;
      wingsActive = false;
      action = "\ud83d\ude10 Idle";
    }
  }
  // shoe timer
  if (shoeActive) {
    shoeTimeLeft -= dt;
    if (shoeTimeLeft <= 0) {
      shoeTimeLeft = 0;
      shoeActive = false;
      action = "😐 Idle";
    }
  }

  // physics
  // if shoe active, reduce gravity slightly for longer airtime
  const gravity = shoeActive ? GRAVITY * SHOES_GRAVITY_MULT : GRAVITY;
  player.vy += gravity;
  player.y += player.vy;
  if (player.y >= ground - player.h) {
    player.y = ground - player.h;
    player.vy = 0;
    player.onGround = true;
  }

  // spawn with probabilities but enforce gap/spacing rules
  if (Math.random() < 0.02) spawnObstacleAt(canvas.width);
  if (Math.random() < 0.01) spawnGapIfAllowed();
  // spawn power-ups occasionally using independent per-type chances
  // ensure we spawn at most POWERUP_SPAWN_CAP per frame
  let spawnedThisFrame = 0;
  if (spawnedThisFrame < POWERUP_SPAWN_CAP && Math.random() < POWERUP_SPAWN_CHANCE_STAR) {
    spawnPowerUpAt(canvas.width, 'star');
    spawnedThisFrame++;
  }
  if (spawnedThisFrame < POWERUP_SPAWN_CAP && Math.random() < POWERUP_SPAWN_CHANCE_WINGS) {
    spawnPowerUpAt(canvas.width, 'wings');
    spawnedThisFrame++;
  }
  if (spawnedThisFrame < POWERUP_SPAWN_CAP && Math.random() < POWERUP_SPAWN_CHANCE_SHOE) {
    spawnPowerUpAt(canvas.width, 'shoe');
    spawnedThisFrame++;
  }
  if (spawnedThisFrame < POWERUP_SPAWN_CAP && Math.random() < POWERUP_SPAWN_CHANCE_FREEZE) {
    spawnPowerUpAt(canvas.width, 'freeze');
    spawnedThisFrame++;
  }
  if (spawnedThisFrame < POWERUP_SPAWN_CAP && Math.random() < POWERUP_SPAWN_CHANCE_REDCROSS) {
    spawnPowerUpAt(canvas.width, 'redcross');
    spawnedThisFrame++;
  }

  // move environment
  obstacles.forEach(o => (o.x -= SCROLL_SPEED));
  gaps.forEach(g => (g.x -= SCROLL_SPEED));
  powerUps.forEach(p => (p.x -= SCROLL_SPEED));
  // advance beams
  beams.forEach(b => b.x += b.vx * dt);

  // advance skeleton walk phase so limbs animate in sync with scroll speed
  // faster scroll -> faster walk cycle. scale factor chosen to look natural.
  // stronger phase advance so walking is visible; ties to scroll speed
  const phaseAdvance = (SCROLL_SPEED / 60) * 100 * dt; // larger multiplier -> faster visible walk
  obstacles.forEach(o => { if (typeof o.phase === 'number') o.phase += phaseAdvance; });

  // check for star pickups after moving power-ups
  checkPowerUpPickup();

  // freeze-gun logic: auto-fire beams while active
  if (freezeGunActive) {
    freezeGunTimeLeft -= dt;
    if (freezeGunTimeLeft <= 0) {
      freezeGunTimeLeft = 0;
      freezeGunActive = false;
    }
    freezeFireCooldown -= dt;
    if (freezeFireCooldown <= 0) {
      // spawn beam from player center toward the right
      const bx = player.x + player.w;
      const by = player.y + player.h / 2;
      beams.push({ x: bx, y: by, vx: FREEZE_BEAM_SPEED, life: 2.0 });
      freezeFireCooldown = FREEZE_BEAM_INTERVAL;
    }
  }

  // beams vs obstacles: freeze enemies they hit
  for (const b of beams) {
    for (const o of obstacles) {
      if (o.frozen) continue; // already frozen
      if (b.x < o.x + o.w && b.x + 6 > o.x && b.y > o.y && b.y < o.y + o.h) {
        o.frozen = true;
        o.freezeTime = FREEZE_DURATION;
        b.life = 0;
      }
    }
  }

  // remove expired beams
  beams = beams.filter(b => b.life > 0 && b.x < canvas.width + 50);
  beams.forEach(b => b.life -= dt);

  // update particles
  for (const p of particles) {
    p.vy += GRAVITY * 0.6 * dt; // light gravity on particles
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0 && p.y < canvas.height + 50);

  // start break immediately if player touches any frozen obstacle (start on first contact)
  for (const o of obstacles) {
    if (o.frozen && !o.breaking) {
      if (
        player.x < o.x + o.w &&
        player.x + player.w > o.x &&
        player.y < o.y + o.h &&
        player.y + player.h > o.y
      ) {
        startObstacleBreak(o);
      }
    }
  }

  // obstacle collision only when no invincibility (shield, star power-up, or debug)
  if (!shieldActive && !powerUpActive && !debugInvincible) {
    for (const o of obstacles) {
      // skip obstacles that are already breaking so player isn't penalized while they shatter
      if (o.breaking) continue;
      if (
        player.x < o.x + o.w &&
        player.x + player.w > o.x &&
        player.y + player.h > o.y
      ) {
        // if obstacle is frozen, touching it triggers a crack-and-break effect
        if (o.frozen) {
          if (!o.breaking) {
            startObstacleBreak(o);
          }
          continue;
        }
        // if red-cross active, consume it and destroy the obstacle instead of dying
        if (redCrossActive) {
          // consume red-cross: allow one safe collision, destroy this obstacle, then
          // stop checking further obstacles this frame so we don't die on a second overlap
          redCrossActive = false;
          redCrossTimeLeft = 0;
          // spawn a small break effect and remove obstacle
          startObstacleBreak(o);
          break; // exit obstacle loop after consuming the one-time hit
        }
        triggerGameOver();
        return;
      }
    }
  }

  // gap death rules: if player's bottom is touching ground AND not invincible/wings -> die if fully inside a gap
  // wingsActive allows crossing gaps (immune to gap death) but not immune to enemy collisions
  if (player.onGround && !powerUpActive && !wingsActive && !debugInvincible) {
    for (const g of gaps) {
      const gapLeft = g.x;
      const gapRight = g.x + g.w;
      if (player.x >= gapLeft && player.x + player.w <= gapRight) {
        // fully inside gap while touching ground => fall
        triggerGameOver();
        return;
      }
    }
  }

  // update breaking obstacles and cleanup
  for (const o of obstacles) {
    if (o.breaking) {
      o.breakTime -= dt;
      if (o.breakTime <= 0) {
        // mark for removal by moving offscreen
        o.x = -9999;
      }
    }
  }
  obstacles = obstacles.filter(o => o.x + o.w > 0);
  gaps = gaps.filter(g => g.x + g.w > 0);
  powerUps = powerUps.filter(p => p.x + p.w > 0 && !p.collected);

  // score
  score += dt * 10;
  const dbgPrefix = debugInvincible ? 'DEBUG: Invincible | ' : '';
  document.getElementById("status").textContent = `${dbgPrefix}${action} | Score: ${Math.floor(score)}`;
}

// Power-up helpers
function spawnPowerUpAt(x, type = 'star') {
  // star size
  const w = 18;
  // choose a height that's reachable: between ground - player.h - 100 and ground - w
  const maxY = ground - w;
  const minY = Math.max(ground - player.h - 120, 40);
  const y = minY + Math.random() * (maxY - minY);
  // tag with provided type
  powerUps.push({ x, y, w, h: w, collected: false, type });
  console.log('[powerup] spawned', type, { x, y, w });
}

function checkPowerUpPickup() {
  for (const p of powerUps) {
    if (p.collected) continue;
    if (
      player.x < p.x + p.w &&
      player.x + player.w > p.x &&
      player.y < p.y + p.h &&
      player.y + player.h > p.y
    ) {
      // pick up
      p.collected = true;
      // handle pickups by type
      if (p.type === 'star') {
        powerUpActive = true;
        powerUpTimeLeft = POWERUP_DURATION;
        action = "\u2b50 Star Power (Invincible)!";
        console.log('[powerup] picked up star - invincibility on');
      } else if (p.type === 'wings') {
        // wings let player cross gaps for a duration but do NOT grant enemy immunity
        wingsActive = true;
        wingsTimeLeft = WINGS_DURATION;
        action = "985 Wings! (Cross gaps)";
        console.log('[powerup] picked up wings - can cross gaps');
      } else if (p.type === 'shoe') {
        // jumping shoe: increase jump height and airtime
        shoeActive = true;
        shoeTimeLeft = SHOES_DURATION;
        action = "👟 Jump Boost!";
        console.log('[powerup] picked up shoe - jump boosted');
      } else if (p.type === 'freeze') {
        // freeze-gun pickup: auto-fire ice beams for a duration
        freezeGunActive = true;
        freezeGunTimeLeft = FREEZE_GUN_DURATION;
        freezeFireCooldown = 0; // allow immediate shot
        action = "🔵 Freeze Gun!";
        console.log('[powerup] picked up freeze gun - firing beams');
      } else if (p.type === 'redcross') {
        // red-cross: allow one collision without dying
        redCrossActive = true;
        redCrossTimeLeft = REDCROSS_DURATION;
        action = "➕ First Aid! (One safe hit)";
        console.log('[powerup] picked up red-cross - next collision safe');
      } else {
        powerUpActive = true;
        powerUpTimeLeft = POWERUP_DURATION;
        action = "Power-up!";
      }
    }
  }
}

function startObstacleBreak(o) {
  o.breaking = true;
  o.breakTime = 0.35; // seconds for break animation
  // spawn some particles centered on obstacle
  const parts = 8 + Math.floor(Math.random() * 6);
  for (let i = 0; i < parts; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 160;
    particles.push({
      x: o.x + o.w / 2,
      y: o.y + o.h / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 30,
      life: 0.6 + Math.random() * 0.6,
      size: 1 + Math.random() * 3,
      color: 'rgba(230,240,255,0.95)'
    });
  }
}


function triggerGameOver() {
  gameOver = true;
  document.getElementById("status").textContent = `💀 Game Over! Score: ${Math.floor(score)}`;
  document.getElementById("tryAgain").style.display = "inline-block";
  // check scoreboard entry
  checkHighScore(Math.floor(score));
}



//////////////////////
// Start everything //
//////////////////////
init().catch(err => {
  console.error("Initialization error:", err);
  document.getElementById("status").textContent = "Failed to load model.";
});

// wire scoreboard UI after load
window.addEventListener('load', () => {
  loadScores();
  renderScores();
  document.getElementById('saveName').addEventListener('click', () => {
    const name = document.getElementById('playerName').value.trim();
    commitName(name);
  });
  document.getElementById('playerName').addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') {
      commitName(e.target.value.trim());
    }
  });
  document.getElementById('resetScores').addEventListener('click', ()=>{
    if (confirm('Clear all saved top scores?')) resetScores();
  });

  // Wire bottom debug dock toggle if present. The game writes debug HTML to #debug
  const debugToggleDock = document.getElementById('debugToggleDock');
  const debugEl = document.getElementById('debug');
  if (debugToggleDock && debugEl) {
    debugToggleDock.addEventListener('click', () => {
      const expanded = debugToggleDock.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        debugEl.classList.remove('expanded');
        debugEl.classList.add('collapsed');
        debugToggleDock.setAttribute('aria-expanded', 'false');
        debugToggleDock.textContent = 'Show debug';
        // Un-hide the debug region for assistive tech when collapsed
        debugEl.setAttribute('aria-hidden', 'true');
      } else {
        debugEl.classList.remove('collapsed');
        debugEl.classList.add('expanded');
        debugToggleDock.setAttribute('aria-expanded', 'true');
        debugToggleDock.textContent = 'Hide debug';
        // Mark the debug region visible to assistive tech when expanded
        debugEl.setAttribute('aria-hidden', 'false');
      }
    });
  // Start collapsed explicitly
  debugEl.classList.add('collapsed');
  debugToggleDock.setAttribute('aria-expanded', 'false');
  debugEl.setAttribute('aria-hidden', 'true');
  }
});