// script.js
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9";
import { drawGame } from './modules/draw.js';
import { loadScores, renderScores, commitName, resetScores, checkHighScore } from './modules/scoreboard.js';

//////////////////////
// Config constants //
//////////////////////
const PLAYER_W = 20;
const PLAYER_H = 32; // match skeleton obstacle height (20x32) so player and skeletons are comparable
const GRAVITY = 0.6;
const JUMP_FORCE = -13;
const SCROLL_SPEED = 1.0;
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

// Sprite-sheet configuration: defaults and per-character metadata
const SPRITE_PATH = 'assets/walk.png';
// Default frame size for sprite sheets (fallback if a character doesn't provide dimensions)
const SPRITE_FRAME_W = 20; // legacy default (20x32)
const SPRITE_FRAME_H = 32;
const SPRITE_COLS = 4;
const SPRITE_ROWS = 1;
const SPRITE_WALK_ROW = 0; // walk frames on the single row
const SPRITE_WALK_FRAMES = 4; // frames across the walk row
const SPRITE_FPS = 12; // default frames per second for sprite animation
// which direction the sprite sheet frames face by default (if 'left', the frames are drawn facing left)
const SPRITE_SHEET_DEFAULT_FACING = 'right'; // this sheet faces right

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
// millisecond timestamp of last reset; used to ignore immediate inputs/pickups for a short grace period
let lastResetTime = 0;
// grace period after a reset during which mouth-open or pickups are ignored (ms)
const RESET_GRACE_MS = 600;
// selection state
let playerChosen = false;
let chosenCharacterIndex = null;
let selectionDotX = 0;
let selectionDotY = 0;
let selectionMouthOpen = false;
const NOSE_MIRROR = true; // mirror nose X so webcam feels like a mirror
// selection hover timing
let selectionHoverIndex = null;
let selectionHoverStart = null; // timestamp in ms when mouth-open began while hovering
const SELECTION_HOLD_MS = 1000; // require 1 second mouth-open to confirm
// allow small brief mouth-closed blips so hover progress isn't too fragile
const MOUTH_CLOSED_TOL_MS = 220; // ms
let selectionMouthClosedSince = 0; // timestamp when mouth was seen closed during hover
// debugging helpers
let selectionIgnoreUntil = 0;
const selectionDebug = {
  hoverProgress: 0,
  hoverIndex: null,
  hoverStart: 0,
  closedSince: 0,
  lastResetReason: null
};
// selection UI modes: when true show selection UI. mode: 'character' or 'postDeath'
let selectionActive = true;
let selectionMode = 'character';
// when showing post-death choices, labels default to these
const POST_DEATH_LABELS = ['Run Again', 'Start Over'];
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

// Death / post-death timing (ms)
const DEATH_DELAY_MS = 1500; // 1.5 seconds delay before showing post-death UI
const DEATH_FADE_MS = 250; // 0.25s fade for post-death screen
let deathStartTime = 0; // timestamp when game over was triggered
let tryAgainShownAfterFade = false;

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

  // start loading player sprite sheets early
  // support per-character frame sizes so we can have both legacy 20x32 sprites and 48x48 sprites
  window.playerSprites = [];
  const CHARACTERS = [
    { path: 'assets/character_1/walk.png', frameW: 20, frameH: 32 },
    { path: 'assets/character_2/walk.png', frameW: 20, frameH: 32 },
    { path: 'assets/llama/walk.png', frameW: 40, frameH: 40 }
  ];
  for (const c of CHARACTERS) {
    // load each and push result (may be null on error)
    // pass per-character frame width/height so the loader slices the sheet correctly
    loadPlayerSprite(c.path, c.frameW || SPRITE_FRAME_W, c.frameH || SPRITE_FRAME_H).then(s => {
      if (s) s.meta = { path: c.path, frameW: c.frameW, frameH: c.frameH };
      window.playerSprites.push(s);
      console.log('[assets] loaded character sprite', c.path, !!s);
    });
  }

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

// Global selection hook called by draw module when mouth-open selection detected
window.__selectPlayer = function(idx) {
  // only allow selecting a player in character selection mode
  if (playerChosen || !selectionActive || selectionMode !== 'character') return;
  console.log('[select] player', idx);
  chosenCharacterIndex = idx;
  playerChosen = true;
  selectionActive = false;
  // attach selected sprite to player
  if (window.playerSprites && window.playerSprites[idx]) {
    player.sprite = window.playerSprites[idx];
  }
  // reset game state to begin proper game
  resetGame();
};

// Post-death choice handler: 0 => Run Again (same character), 1 => Start Over (go to character selection)
window.__postDeathChoice = function(idx) {
  if (!selectionActive || selectionMode !== 'postDeath') return;
  console.log('[postDeath] choice', idx);
  if (idx === 0) {
    // Run Again: keep chosenCharacterIndex, restart game
    selectionActive = false;
    selectionMode = 'character';
    resetGame();
    detectLoop();
    requestAnimationFrame(gameLoop);
  } else if (idx === 1) {
    // Start Over: clear chosen player and go back to character selection
    playerChosen = false;
    chosenCharacterIndex = null;
    // Immediately show the character selection UI, but set a short ignore window
    // so the user's nose/mouth don't accidentally re-confirm the previously-hovered card.
    const now = performance.now();
    lastResetTime = now; // keep pickup-ignoring behavior
    selectionIgnoreUntil = now + 800; // ignore hover input for 800ms
    // clear death timing so the post-death fade logic won't later flip the UI
    deathStartTime = 0;
    tryAgainShownAfterFade = false;
    // hide the Try Again HTML control and show character selection immediately
    try { document.getElementById("tryAgain").style.display = "none"; } catch (e) {}
    selectionActive = true;
    selectionMode = 'character';
    // ensure detection and draw loops are running so the selection UI is painted
    detectLoop();
    try { requestAnimationFrame(gameLoop); } catch (e) { /* noop if not available */ }
    // leave detectLoop running; gameLoop will draw selection screen after the brief pause
  }
  // reset hover state
  selectionHoverIndex = null;
  selectionHoverStart = null;
};

// Helper: load sprite and return metadata
function loadPlayerSprite(path, frameW, frameH) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cols = Math.floor(img.naturalWidth / frameW);
      const rows = Math.floor(img.naturalHeight / frameH);
      // create an offscreen canvas to inspect pixel data for each frame
      const oc = document.createElement('canvas');
      oc.width = img.naturalWidth;
      oc.height = img.naturalHeight;
      const octx = oc.getContext('2d');
      octx.drawImage(img, 0, 0);

      const frameBoxes = new Array(cols * rows);
      for (let ry = 0; ry < rows; ry++) {
        for (let cx = 0; cx < cols; cx++) {
          const fx = cx * frameW;
          const fy = ry * frameH;
          const data = octx.getImageData(fx, fy, frameW, frameH).data;
          let minX = frameW, minY = frameH, maxX = -1, maxY = -1;
          for (let py = 0; py < frameH; py++) {
            for (let px = 0; px < frameW; px++) {
              const idx = (py * frameW + px) * 4;
              const alpha = data[idx + 3];
              if (alpha > 10) {
                if (px < minX) minX = px;
                if (py < minY) minY = py;
                if (px > maxX) maxX = px;
                if (py > maxY) maxY = py;
              }
            }
          }
          const frameIndex = ry * cols + cx;
          if (maxX >= 0) {
            const contentCenterX = (minX + maxX) / 2;
            const contentBottomY = maxY;
            frameBoxes[frameIndex] = { minX, minY, maxX, maxY, contentCenterX, contentBottomY };
          } else {
            // empty frame: default values
            frameBoxes[frameIndex] = { minX: 0, minY: 0, maxX: frameW - 1, maxY: frameH - 1, contentCenterX: frameW / 2, contentBottomY: frameH - 1 };
          }
        }
      }

      // attach default facing info and per-frame boxes for alignment
      resolve({ image: img, frameW, frameH, cols, rows, width: img.naturalWidth, height: img.naturalHeight, defaultFacing: SPRITE_SHEET_DEFAULT_FACING, frameBoxes });
    };
    img.onerror = () => resolve(null);
    img.src = path;
  });
}

//////////////////////
// Reset / TryAgain //
//////////////////////
function resetGame() {
  player = { x: 50, y: 240, w: PLAYER_W, h: PLAYER_H, vy: 0, onGround: true, stepPhase: 0 };
  // attach sprite metadata if loaded
  // default player sprite is first loaded character if selection already made
  if (playerChosen && typeof chosenCharacterIndex === 'number' && window.playerSprites[chosenCharacterIndex]) {
    player.sprite = window.playerSprites[chosenCharacterIndex];
  } else {
    player.sprite = window.playerSprites[0] || null;
  }
  player.facing = 'right';
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
  // record reset time so we can ignore immediate mouth triggers / accidental pickups
  lastResetTime = performance.now();
  // reset death timing
  deathStartTime = 0;
  tryAgainShownAfterFade = false;
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

  // update selection dot position (map normalized nose coords to canvas)
  // nose.x is normalized 0..1 (left=0 right=1) relative to camera; convert to canvas coords
  const nx = NOSE_MIRROR ? (1 - nose.x) : nose.x;
  selectionDotX = nx * canvas.width;
  selectionDotY = nose.y * canvas.height;

  // mouth open detection for selection
  selectionMouthOpen = mouthOpen;

      // shield: rising edge detection (start shield only when mouth opens newly and shield depleted)
      // ignore mouth-triggered shields for a short grace period after reset or respawn
      const sinceReset = performance.now() - lastResetTime;
      if (mouthOpen && !wasMouthOpen && !shieldActive && shieldTimeLeft <= 0 && sinceReset > RESET_GRACE_MS) {
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

  // keep detectLoop running while the game is running OR while selection UI is active
  // Also keep running during the death delay + fade so the nose cursor updates while the UI appears
  let keepDetectRunning = false;
  if (!gameOver) keepDetectRunning = true;
  else if (selectionActive) keepDetectRunning = true;
  else if (gameOver && deathStartTime) {
    const elapsed = performance.now() - deathStartTime;
    if (elapsed < (DEATH_DELAY_MS + DEATH_FADE_MS)) keepDetectRunning = true;
  }
  if (keepDetectRunning) requestAnimationFrame(detectLoop);
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

  // If the game is still running, update the game state.
  if (!gameOver) {
    updateGame(delta);
  }

  // --- Selection hover timing logic (require sustained mouth-open to confirm) ---
  // Determine if the nose dot is over one of the choice cards and update hover timers.
  let hoverIndex = null;
  let hoverProgress = 0;
  // run hover detection when selection UI is active (either initial selection or post-death)
  if (selectionActive && typeof selectionDotX === 'number') {
    const choiceY = canvas.height / 2 - 10;
    const spacing = 120;
    // determine how many choices to check: character selection uses number of loaded sprites; post-death uses 2 options
    let numChoices = (window.playerSprites && window.playerSprites.length) ? window.playerSprites.length : 2;
    if (selectionMode === 'postDeath') numChoices = 2;
    // center the choice cards horizontally based on the count
    const totalWidth = spacing * (numChoices - 1);
    const startX = canvas.width / 2 - totalWidth / 2;
    for (let i = 0; i < numChoices; i++) {
      const sx = startX + i * spacing;
      const rect = { x: sx - 40, y: choiceY - 40, w: 80, h: 100 };
      if (selectionDotX >= rect.x && selectionDotX <= rect.x + rect.w && selectionDotY >= rect.y && selectionDotY <= rect.y + rect.h) {
        hoverIndex = i;
        break;
      }
    }

    const now = performance.now();
    // expose some debug state
    selectionDebug.hoverIndex = hoverIndex;
    selectionDebug.hoverStart = selectionHoverStart || 0;
    selectionDebug.closedSince = selectionMouthClosedSince || 0;
    selectionDebug.ignoreUntil = selectionIgnoreUntil || 0;

    // ignore hover input entirely while we're inside an explicit ignore window
    if (now < (selectionIgnoreUntil || 0)) {
      // still in ignore window: clear any hover progress and skip selection checks
      selectionHoverIndex = null;
      selectionHoverStart = null;
      selectionMouthClosedSince = 0;
      selectionDebug.lastResetReason = 'ignoreGuard';
      hoverIndex = null;
      hoverProgress = 0;
    } else if (hoverIndex !== null && selectionMouthOpen) {
      // start or continue the hover timer for this index
      // clear any closed-since timer
      selectionMouthClosedSince = 0;
      if (selectionHoverIndex === hoverIndex) {
        if (!selectionHoverStart) selectionHoverStart = now;
      } else {
        selectionHoverIndex = hoverIndex;
        selectionHoverStart = now;
      }
      hoverProgress = Math.min(1, (now - (selectionHoverStart || now)) / SELECTION_HOLD_MS);
      selectionDebug.hoverProgress = hoverProgress;

      // confirm selection if held long enough
      if (hoverProgress >= 1) {
        if (selectionMode === 'character') {
          if (window && typeof window.__selectPlayer === 'function') window.__selectPlayer(hoverIndex);
        } else if (selectionMode === 'postDeath') {
          if (window && typeof window.__postDeathChoice === 'function') window.__postDeathChoice(hoverIndex);
        }
  // reset hover state so it doesn't immediately re-trigger
  console.log('[select] confirmed', { mode: selectionMode, index: hoverIndex, now });
  selectionHoverIndex = null;
  selectionHoverStart = null;
  selectionMouthClosedSince = 0;
  selectionDebug.lastResetReason = `confirmed:${selectionMode}:${hoverIndex}`;
  hoverProgress = 0;
      }
    } else {
      // not hovering with mouth open -> allow a short tolerance before fully resetting
      if (hoverIndex !== null) {
        // if we were hovering and just saw mouth closed, start/continue closed timer
        if (!selectionMouthClosedSince) selectionMouthClosedSince = now;
        const closedFor = now - selectionMouthClosedSince;
        if (closedFor < MOUTH_CLOSED_TOL_MS) {
          // keep hover progress but don't increase it
          hoverProgress = Math.min(1, (now - (selectionHoverStart || now)) / SELECTION_HOLD_MS);
          selectionDebug.hoverProgress = hoverProgress;
        } else {
          // closed for too long -> reset
          console.log('[select] reset due to mouth closed', { closedFor, now });
          selectionHoverIndex = null;
          selectionHoverStart = null;
          selectionMouthClosedSince = 0;
          selectionDebug.lastResetReason = `mouthClosed:${Math.round(closedFor)}`;
          hoverProgress = 0;
        }
      } else {
        // not hovering at all -> clear
        selectionHoverIndex = null;
        selectionHoverStart = null;
        selectionMouthClosedSince = 0;
        selectionDebug.lastResetReason = 'notHovering';
        hoverProgress = 0;
      }
    }
  }

  // Draw the current scene or selection UI
  // compute death/post-death timing and selection fade
  let selectionFadeAlpha = 1; // default fully visible
  if (gameOver && deathStartTime) {
    const elapsed = performance.now() - deathStartTime;
    if (elapsed < DEATH_DELAY_MS) {
      // still in death delay period - show red X overlay via draw module; keep selection inactive
      selectionActive = false;
      selectionMode = null;
      selectionFadeAlpha = 0;
    } else {
      // after delay, enable post-death selection and compute fade progress
      selectionActive = true;
      selectionMode = 'postDeath';
      const fadeElapsed = Math.min(DEATH_FADE_MS, elapsed - DEATH_DELAY_MS);
      selectionFadeAlpha = Math.min(1, fadeElapsed / DEATH_FADE_MS);
      // only show Try Again button after full fade-in complete
      if (!tryAgainShownAfterFade && elapsed >= DEATH_DELAY_MS + DEATH_FADE_MS) {
        document.getElementById("tryAgain").style.display = "inline-block";
        tryAgainShownAfterFade = true;
      }
    }
  }

  drawGame({
    ctx, canvas, ground, gaps, obstacles, powerUps, beams, particles, player,
    powerUpActive, powerUpTimeLeft, POWERUP_DURATION,
    shieldActive, shieldTimeLeft, SHIELD_DURATION,
    wingsActive, shoeActive, redCrossActive,
    noseVisualOffset, INDICATOR_BASELINE_Y, INDICATOR_SCALE,
    JUMP_NOSE_THRESHOLD, RAINBOW_HUE_SPEED, RAINBOW_PULSE_SPEED,
    // pass the player's stepPhase so the renderer can animate walking
    stepPhase: player.stepPhase,
    // selection UI state (include hover progress)
    selection: {
      active: selectionActive,
      mode: selectionMode,
      fadeAlpha: selectionFadeAlpha,
      dotX: selectionDotX,
      dotY: selectionDotY,
      mouthOpen: selectionMouthOpen,
      sprites: window.playerSprites || [],
      hoverIndex: selectionHoverIndex,
      hoverProgress: (typeof hoverProgress === 'number') ? hoverProgress : 0,
      postDeathLabels: POST_DEATH_LABELS,
      postDeathEmojis: ['🏃‍➡️', '🔁']
    },
    score
  });

  // show selection debug in the debug panel for easier tracing
  const dbgEl = document.getElementById('debug');
  if (dbgEl) {
    const extra = `
      <hr>
      HoverIndex: ${selectionDebug.hoverIndex}<br>
      HoverProgress: ${(selectionDebug.hoverProgress*100).toFixed(0)}%<br>
      HoverStart: ${Math.round(selectionDebug.hoverStart)}<br>
      ClosedSince: ${Math.round(selectionDebug.closedSince)}<br>
      IgnoreUntil: ${Math.round(selectionDebug.ignoreUntil)}<br>
      LastReset: ${selectionDebug.lastResetReason}
    `;
    dbgEl.innerHTML = dbgEl.innerHTML + extra;
  }

  // continue the main loop while the game is running or the selection UI is active
  // Also keep running while we're in the death delay + fade period so the red X can show
  let keepRunning = false;
  if (!gameOver) keepRunning = true;
  else if (selectionActive) keepRunning = true;
  else if (gameOver && deathStartTime) {
    const elapsed = performance.now() - deathStartTime;
    if (elapsed < (DEATH_DELAY_MS + DEATH_FADE_MS)) keepRunning = true;
  }
  if (keepRunning) requestAnimationFrame(gameLoop);
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

  // advance player step phase for walking animation; tie to scroll speed so legs move when level moves
  // stepPhase is in seconds-like units; increase multiplier so walking looks faster
  player.stepPhase += (SCROLL_SPEED / 60) * 14 * dt;

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
  // ignore pickups immediately after a reset to avoid accidental collection during selection
  const sinceReset = performance.now() - lastResetTime;
  const ignorePickups = sinceReset <= RESET_GRACE_MS;

  for (const p of powerUps) {
    if (p.collected) continue;
    if (
      player.x < p.x + p.w &&
      player.x + player.w > p.x &&
      player.y < p.y + p.h &&
      player.y + player.h > p.y
    ) {
      if (ignorePickups) {
        // skip processing pickups that happen within the reset grace window
        console.log('[powerup] pickup ignored due to reset grace', p.type);
        p.collected = false; // keep it available
        continue;
      }
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
  // mark game over and start death timer; actual post-death UI will appear after a short delay
  gameOver = true;
  document.getElementById("status").textContent = `💀 Game Over! Score: ${Math.floor(score)}`;
  // record when death occurred so we can show red X and then fade in UI
  deathStartTime = performance.now();
  tryAgainShownAfterFade = false;
  // check scoreboard entry immediately (so score is recorded)
  checkHighScore(Math.floor(score));
  // keep detectLoop running so the nose cursor updates while waiting / on selection screen
  detectLoop();
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