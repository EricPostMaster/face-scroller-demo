// script.js
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9";

//////////////////////
// Config constants //
//////////////////////
const PLAYER_W = 20;
const PLAYER_H = 20;
const GRAVITY = 0.6;
const JUMP_FORCE = -10;
const SCROLL_SPEED = 3;
const SHIELD_DURATION = 3.0; // seconds
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
  canvas = document.getElementById("gameCanvas");
  ctx = canvas.getContext("2d");

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
  ground = canvas.height - 40;
  obstacles = [];
  gaps = [];
  score = 0;
  gameOver = false;
  baselineNoseY = null;
  wasMouthOpen = false;
  jumpCooldown = false;
  shieldActive = false;
  shieldTimeLeft = 0;
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

      // update debug panel numerics
      document.getElementById("debug").innerHTML = `
        Nose Y: ${nose.y.toFixed(3)}<br>
        Baseline Nose Y: ${baselineNoseY.toFixed(3)}<br>
        Nose Rise: ${noseRise.toFixed(3)}<br>
        Mouth Open Amount: ${mouthOpenAmount.toFixed(3)}<br>
        Invincible: ${debugInvincible}<br>
        wasMouthOpen: ${wasMouthOpen}<br>
        shieldActive: ${shieldActive}<br>
        shieldTimeLeft: ${shieldTimeLeft.toFixed(2)}s<br>
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
    player.vy = JUMP_FORCE;
    player.onGround = false;
  }
  jumpCooldown = true;
  setTimeout(() => (jumpCooldown = false), 800);
}

//////////////////////
// Level spawn utils//
//////////////////////
function spawnObstacleAt(x) {
  const w = 20, h = 20;
  const overlapsGap = gaps.some(g => !(x + w <= g.x || x >= g.x + g.w));
  if (!overlapsGap) obstacles.push({ x, y: ground - h, w, h });
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

  // physics
  player.vy += GRAVITY;
  player.y += player.vy;
  if (player.y >= ground - player.h) {
    player.y = ground - player.h;
    player.vy = 0;
    player.onGround = true;
  }

  // spawn with probabilities but enforce gap/spacing rules
  if (Math.random() < 0.02) spawnObstacleAt(canvas.width);
  if (Math.random() < 0.01) spawnGapIfAllowed();

  // move environment
  obstacles.forEach(o => (o.x -= SCROLL_SPEED));
  gaps.forEach(g => (g.x -= SCROLL_SPEED));

  // obstacle collision only when shield inactive
  if (!shieldActive && !debugInvincible) {
    for (const o of obstacles) {
      if (
        player.x < o.x + o.w &&
        player.x + player.w > o.x &&
        player.y + player.h > o.y
      ) {
        triggerGameOver();
        return;
      }
    }
  }

  // gap death rules:
  // if player's bottom is touching ground (player.onGround) AND player's horizontal span is fully inside a gap -> die.
  if (player.onGround && !debugInvincible) {
    for (const g of gaps) {
      const gapLeft = g.x;
      const gapRight = g.x + g.w;
      if (player.x >= gapLeft && player.x + player.w <= gapRight) {
        // fully inside gap while touching ground => fall
        triggerGameOver();
        return;
      }
      // if partially overlapping gap but any part on ground, continue playing
    }
  }

  // cleanup
  obstacles = obstacles.filter(o => o.x + o.w > 0);
  gaps = gaps.filter(g => g.x + g.w > 0);

  // score
  score += dt * 10;
  const dbgPrefix = debugInvincible ? 'DEBUG: Invincible | ' : '';
  document.getElementById("status").textContent = `${dbgPrefix}${action} | Score: ${Math.floor(score)}`;
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

  // obstacles (red)
  ctx.fillStyle = "#f44";
  for (const o of obstacles) ctx.fillRect(o.x, o.y, o.w, o.h);

  // player
  ctx.fillStyle = "#4af";
  ctx.fillRect(player.x, player.y, player.w, player.h);

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
});