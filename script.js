// script.js
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9";

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
// Scoreboard state
const SCORE_KEY = 'faceScroller_topScores';
let topScores = []; // {name, score}
let pendingScore = null; // numeric score waiting for name

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
    drawGame();
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
// Scoreboard logic //
//////////////////////
function loadScores() {
  try {
    const raw = localStorage.getItem(SCORE_KEY);
    topScores = raw ? JSON.parse(raw) : [];
    // normalize
    if (!Array.isArray(topScores)) topScores = [];
  } catch (e) {
    console.warn('Failed to load scores', e);
    topScores = [];
  }
}

function saveScores() {
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(topScores));
  } catch (e) {
    console.warn('Failed to save scores', e);
  }
}

function renderScores() {
  const el = document.getElementById('scoreList');
  el.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const row = document.createElement('li');
    row.className = 'scoreRow';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'scoreName';
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'scoreValue';
    if (topScores[i]) {
      nameSpan.textContent = `${i+1}. ${topScores[i].name}`;
      scoreSpan.textContent = `${topScores[i].score}`;
    } else {
      nameSpan.textContent = `${i+1}. —`;
      scoreSpan.textContent = `0`;
    }
    row.appendChild(nameSpan);
    row.appendChild(scoreSpan);
    el.appendChild(row);
  }
}

function checkHighScore(s) {
  // Determine if score qualifies for top 5
  const scores = topScores.map(x => x.score).slice();
  scores.push(s);
  scores.sort((a,b)=>b-a);
  const rank = scores.indexOf(s);
  if (rank >=0 && rank < 5) {
    // show name prompt
    pendingScore = s;
    const prompt = document.getElementById('namePrompt');
    prompt.style.display = 'block';
    const input = document.getElementById('playerName');
    input.value = '';
    input.focus();
  } else {
    // not a high score, nothing to do
    pendingScore = null;
  }
}

function commitName(name) {
  if (!pendingScore) return;
  const entry = { name: name || 'Anon', score: pendingScore };
  topScores.push(entry);
  topScores.sort((a,b)=>b.score - a.score);
  topScores = topScores.slice(0,5);
  saveScores();
  renderScores();
  pendingScore = null;
  document.getElementById('namePrompt').style.display = 'none';
}

function resetScores() {
  topScores = [];
  saveScores();
  renderScores();
}

//////////////////////
// Drawing function  //
//////////////////////
function drawGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ground
  ctx.fillStyle = "#444";
  ctx.fillRect(0, ground, canvas.width, canvas.height - ground);

  // gaps (erase ground)
  ctx.fillStyle = "#111";
  for (const g of gaps) {
    ctx.fillRect(g.x, ground, g.w, canvas.height - ground);
  }

  // obstacles (skeletons)
  for (const o of obstacles) {
    drawSkeleton(ctx, o.x, o.y, o.w, o.h, o.phase || 0);
    if (o.frozen) {
      // icy overlay to indicate frozen enemy
      ctx.fillStyle = 'rgba(170,220,255,0.28)';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      // frost rim
      ctx.strokeStyle = 'rgba(200,240,255,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
    }
    if (o.breaking) {
      // draw a quick crack overlay centered on obstacle
      ctx.strokeStyle = 'rgba(220,240,255,0.95)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI * 2 * i) / 5 + Math.random() * 0.6;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * (o.w * (0.3 + Math.random() * 0.5)), cy + Math.sin(a) * (o.h * (0.3 + Math.random() * 0.5)));
      }
      ctx.stroke();
    }
  }

  // power-ups (shiny yellow star)
  for (const p of powerUps) {
    if (p.collected) continue;
    if (p.type === 'star') {
      drawStar(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w / 2, p.w / 4, 5);
      // add a shiny highlight
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.ellipse(p.x + p.w * 0.35, p.y + p.h * 0.28, p.w * 0.12, p.h * 0.08, -0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'wings') {
      drawWingsIcon(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w * 0.9);
    } else if (p.type === 'shoe') {
      drawShoeIcon(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w * 0.9);
    } else if (p.type === 'freeze') {
      drawFreezeGunIcon(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w * 0.9);
    } else if (p.type === 'redcross') {
      drawRedCrossIcon(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w * 0.9);
    } else {
      // fallback: draw star
      drawStar(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w / 2, p.w / 4, 5);
    }
  }

  // draw active beams
  for (const b of beams) {
    drawBeam(ctx, b.x, b.y);
  }

  // player (rainbow pulse when power-up active)
  if (powerUpActive) {
    // create pulsing rainbow color based on time
  const now = performance.now();
  const hue = (now / RAINBOW_HUE_SPEED * 360) % 360;
  // pulse brightness
  const pulse = 0.6 + 0.4 * Math.sin(now / RAINBOW_PULSE_SPEED);
    ctx.fillStyle = `hsl(${hue},90%,${50 * pulse}%)`;
    ctx.fillRect(player.x, player.y, player.w, player.h);
    // glowing outline
    ctx.strokeStyle = `hsla(${hue},90%,60%,0.9)`;
    ctx.lineWidth = 3;
    ctx.strokeRect(player.x - 2, player.y - 2, player.w + 4, player.h + 4);
  } else {
    // normal player
    ctx.fillStyle = "#4af";
    ctx.fillRect(player.x, player.y, player.w, player.h);
  }

  // wings active visual: small wing badges at player's shoulders
  if (wingsActive) {
    const lx = player.x - 6;
    const rx = player.x + player.w + 6;
    const cy = player.y + player.h * 0.35;
    drawSmallWing(ctx, lx, cy, 10, 6);
    drawSmallWing(ctx, rx, cy, 10, 6, true);
  }
  // shoe active visual: small shoe badge near player's feet
  if (shoeActive) {
    drawSmallShoe(ctx, player.x + player.w / 2, player.y + player.h + 6, 12, 8);
  }
  // red-cross active visual: small red cross near player's head
  if (redCrossActive) {
    drawRedCrossIcon(ctx, player.x + player.w / 2, player.y - 18, 14);
  }

  // shield visuals
  const barFull = player.w * 1.6;
  if (shieldActive) {
    // circular overlay
    ctx.strokeStyle = "rgba(0,255,255,0.7)";
    ctx.lineWidth = 3;
    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(player.w, player.h) * 1.6, 0, Math.PI * 2);
    ctx.stroke();

    // top bar
    ctx.fillStyle = "#0ff";
    const barWidth = barFull * (shieldTimeLeft / SHIELD_DURATION);
    ctx.fillRect(player.x - (barFull - player.w) / 2, player.y - 12, barWidth, 6);
    ctx.strokeStyle = "#003";
    ctx.strokeRect(player.x - (barFull - player.w) / 2, player.y - 12, barFull, 6);
  } else {
    ctx.strokeStyle = "#333";
    ctx.strokeRect(player.x - (barFull - player.w) / 2, player.y - 12, barFull, 6);
  }

  // power-up (star) visual bar: draw above the shield bar
  const powerBarFull = barFull;
  const powerBarX = player.x - (powerBarFull - player.w) / 2;
  const powerBarY = player.y - 20; // 8px above shield bar
  if (powerUpActive) {
    // yellow filling proportional to remaining time
    ctx.fillStyle = "#ffd54f"; // warm yellow
    const pw = powerBarFull * (powerUpTimeLeft / POWERUP_DURATION);
    ctx.fillRect(powerBarX, powerBarY, pw, 6);
    // outline
    ctx.strokeStyle = "#6b4";
    ctx.strokeRect(powerBarX, powerBarY, powerBarFull, 6);
  }

  // draw particles (shards)
  for (const p of particles) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life / 0.8);
    ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    ctx.globalAlpha = 1;
  }

  // Visual nose indicator at top center
  const centerX = canvas.width / 2;
  const baselineY = INDICATOR_BASELINE_Y;

  // baseline line (solid blue)
  ctx.strokeStyle = "#3aa";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - 60, baselineY);
  ctx.lineTo(centerX + 60, baselineY);
  ctx.stroke();

  // jump threshold dotted line (below baseline if threshold positive)
  const thresholdPx = -JUMP_NOSE_THRESHOLD * INDICATOR_SCALE; // map threshold to px (note sign)
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "#3aa";
  ctx.beginPath();
  ctx.moveTo(centerX - 60, baselineY + thresholdPx);
  ctx.lineTo(centerX + 60, baselineY + thresholdPx);
  ctx.stroke();
  ctx.setLineDash([]);

  // nose position dot (red) — clamp so it stays visually inside box
  const maxOffset = 80;
  let visualY = baselineY + Math.max(-maxOffset, Math.min(maxOffset, noseVisualOffset));
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(centerX, visualY, 5, 0, Math.PI * 2);
  ctx.fill();

  // score (top-right)
  ctx.fillStyle = "#fff";
  ctx.font = "16px sans-serif";
  ctx.fillText("Score: " + Math.floor(score), canvas.width - 110, 24);
}

// drawStar helper: draws a filled star at cx,cy with outer/inner radii and points
function drawStar(ctx, cx, cy, outerR, innerR, points) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 === 0) ? outerR : innerR;
    const a = (Math.PI * i) / points;
    const x = cx + Math.cos(a - Math.PI / 2) * r;
    const y = cy + Math.sin(a - Math.PI / 2) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffd700"; // gold/yellow
  ctx.fill();
  // add subtle radial shine
  const g = ctx.createRadialGradient(cx - outerR * 0.2, cy - outerR * 0.35, 2, cx, cy, outerR * 1.2);
  g.addColorStop(0, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.15)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

// drawSkeleton helper: draws a taller stylized skeleton and animates limbs using phase
function drawSkeleton(ctx, x, y, w, h, phase = 0) {
  ctx.save();
  // operate in a 20x32 unit space (width x height)
  const UW = 20, UH = 32;
  ctx.translate(x, y);
  const sx = w / UW;
  const sy = h / UH;
  ctx.scale(sx, sy);

  // small vertical bob so walking looks lively (make slightly larger)
  const bob = Math.sin(phase * 2) * 1.4; // units
  ctx.translate(0, bob);

  // colors
  const boneFill = "#fff";
  const boneStroke = "#111";

  // HEAD
  ctx.fillStyle = boneFill;
  ctx.beginPath();
  ctx.ellipse(10, 6, 6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // jaw
  ctx.fillRect(7, 10, 6, 3);

  // eyes
  ctx.fillStyle = boneStroke;
  ctx.beginPath(); ctx.ellipse(8, 6, 1.6, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(12, 6, 1.6, 2, 0, 0, Math.PI * 2); ctx.fill();
  // nose
  ctx.beginPath(); ctx.moveTo(10, 8); ctx.lineTo(9, 9.2); ctx.lineTo(11, 9.2); ctx.closePath(); ctx.fill();

  // NECK / TORSO
  ctx.strokeStyle = boneFill;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(10, 13);
  ctx.lineTo(10, 18);
  ctx.stroke();

  // rib-ish horizontal bones
  ctx.beginPath();
  ctx.moveTo(6, 15); ctx.lineTo(14, 15);
  ctx.moveTo(6.5, 17); ctx.lineTo(13.5, 17);
  ctx.stroke();

  // pelvis
  ctx.beginPath();
  ctx.moveTo(8.5, 19); ctx.lineTo(11.5, 19);
  ctx.stroke();

  // limbs animation: legs and arms swing opposite each other
  // larger swings for more visible animation
  const legSwing = Math.sin(phase) * 5; // px in unit space
  const legLift = Math.max(0, Math.sin(phase)) * 3;
  const armSwing = Math.sin(phase + Math.PI) * 4;

  // LEGS (from pelvis ~ y=19 down to feet ~ y=28)
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  // left leg
  ctx.moveTo(10, 19);
  ctx.lineTo(10 - 3 + legSwing, 26 + legLift);
  // right leg
  ctx.moveTo(10, 19);
  ctx.lineTo(10 + 3 + -legSwing, 26 + Math.max(0, -Math.sin(phase)) * 2);
  ctx.stroke();

  // small feet
  ctx.beginPath();
  ctx.moveTo(7.5 + legSwing, 27.5); ctx.lineTo(9 + legSwing, 27.5);
  ctx.moveTo(11 + -legSwing, 27.5); ctx.lineTo(12.5 + -legSwing, 27.5);
  ctx.stroke();

  // ARMS (shoulder around y=14). simple two-segment look
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  // left arm from shoulder (10,14) to elbow to hand
  ctx.moveTo(10, 14);
  ctx.lineTo(10 - 5 + armSwing, 16 + (Math.sin(phase) * 1.2));
  // right arm
  ctx.moveTo(10, 14);
  ctx.lineTo(10 + 5 + -armSwing, 16 + (Math.sin(phase + Math.PI) * 1.2));
  ctx.stroke();

  // subtle outline on head
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.ellipse(10, 6, 6, 5, 0, 0, Math.PI * 2); ctx.stroke();

  ctx.restore();
}

// drawWingsIcon: stylized wings used for pickups
function drawWingsIcon(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size / 40;
  ctx.scale(s, s);
  // left wing
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.bezierCurveTo(-22, -6, -26, -18, -14, -22);
  ctx.bezierCurveTo(-6, -18, -2, -12, 0, -8);
  ctx.fillStyle = '#9be7ff';
  ctx.fill();
  // right wing (mirror)
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.bezierCurveTo(22, -6, 26, -18, 14, -22);
  ctx.bezierCurveTo(6, -18, 2, -12, 0, -8);
  ctx.fillStyle = '#9be7ff';
  ctx.fill();
  // outline
  ctx.strokeStyle = 'rgba(10,80,90,0.6)';
  ctx.lineWidth = 2 / s;
  ctx.stroke();
  ctx.restore();
}

// drawShoeIcon: stylized jumping shoe used for pickups
function drawShoeIcon(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size / 40;
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(-12, 6);
  ctx.quadraticCurveTo(-6, -2, 6, -2);
  ctx.quadraticCurveTo(12, -2, 14, 2);
  ctx.quadraticCurveTo(10, 8, -8, 10);
  ctx.closePath();
  ctx.fillStyle = '#ffcc80';
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,40,10,0.6)';
  ctx.lineWidth = 1.2 / s;
  ctx.stroke();
  // laces
  ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(4, 0); ctx.strokeStyle = 'rgba(150,90,50,0.6)'; ctx.lineWidth = 0.8 / s; ctx.stroke();
  ctx.restore();
}

function drawSmallShoe(ctx, cx, cy, w, h) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(-w/2, 0);
  ctx.quadraticCurveTo(-w/4, -h/2, w/4, -h/2);
  ctx.quadraticCurveTo(w/2, -h/2, w/2, 0);
  ctx.fillStyle = '#ffcc80';
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,40,10,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// drawFreezeGunIcon: small blue freeze-gun pickup visual
function drawFreezeGunIcon(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size / 40;
  ctx.scale(s, s);
  // barrel
  ctx.fillStyle = '#7fc9ff';
  ctx.fillRect(-10, -4, 18, 8);
  // muzzle
  ctx.fillStyle = '#5fb0ff';
  ctx.fillRect(8, -3, 6, 6);
  // grip
  ctx.fillStyle = '#3f7fb0';
  ctx.fillRect(-12, 2, 6, 6);
  ctx.restore();
}

function drawBeam(ctx, x, y) {
  // Thin light-blue beam: a single stroked line with a soft glow
  ctx.save();
  // subtle outer glow using shadow
  ctx.strokeStyle = 'rgba(160,220,255,0.95)';
  ctx.lineWidth = 2.2; // thin line
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(140,200,255,0.65)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  // draw line slightly angled to the right
  ctx.moveTo(x, y);
  ctx.lineTo(x + 18, y - 4);
  ctx.stroke();

  // inner brighter core (no shadow) to make the beam look crisp
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(200,240,255,1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 18, y - 4);
  ctx.stroke();

  ctx.restore();
}

// draw red cross icon for pickup
function drawRedCrossIcon(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size / 40;
  ctx.scale(s, s);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-6, -2, 12, 4);
  ctx.fillRect(-2, -6, 4, 12);
  ctx.strokeStyle = 'rgba(180,20,20,0.9)';
  ctx.lineWidth = 2 / s;
  ctx.strokeRect(-8, -8, 16, 16);
  ctx.restore();
}

// small shoulder wing for player badge; flip horizontally when mirror=true
function drawSmallWing(ctx, cx, cy, w, h, mirror = false) {
  ctx.save();
  ctx.translate(cx, cy);
  if (mirror) ctx.scale(-1, 1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-4, -4, -8, -6);
  ctx.quadraticCurveTo(-6, -2, -2, -1);
  ctx.fillStyle = '#9be7ff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(5,60,70,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
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