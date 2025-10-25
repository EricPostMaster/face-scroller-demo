import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9";

let video, faceLandmarker, baselineNoseY = null, jumpCooldown = false;
let canvas, ctx, player, ground, obstacles, gaps, score, gameOver, lastFrameTime;
let action = "😐 Idle";
const GRAVITY = 0.6;
const JUMP_FORCE = -10;
const SCROLL_SPEED = 3;

async function init() {
  canvas = document.getElementById("gameCanvas");
  ctx = canvas.getContext("2d");

  video = document.getElementById("webcam");
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  await new Promise(r => video.onloadedmetadata = r);

  const resolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(resolver, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-assets/face_landmarker.task"
    },
    outputFaceBlendshapes: true,
    runningMode: "VIDEO",
    numFaces: 1
  });

  resetGame();
  detectLoop();
  gameLoop();
}

function resetGame() {
  player = { x: 50, y: 240, w: 20, h: 20, vy: 0, onGround: true };
  ground = 260;
  obstacles = [];
  gaps = [];
  score = 0;
  gameOver = false;
  document.getElementById("tryAgain").style.display = "none";
  lastFrameTime = performance.now();
}

function jump() {
  if (player.onGround) {
    player.vy = JUMP_FORCE;
    player.onGround = false;
  }
}

function endGame() {
  gameOver = true;
  document.getElementById("status").textContent = `💀 Game Over! Score: ${Math.floor(score)}`;
  document.getElementById("tryAgain").style.display = "inline-block";
}

document.getElementById("tryAgain").addEventListener("click", () => {
  resetGame();
});

async function detectLoop() {
  const results = await faceLandmarker.detectForVideo(video, performance.now());

  if (results.faceLandmarks && results.faceLandmarks.length > 0) {
    const landmarks = results.faceLandmarks[0];
    const nose = landmarks[1];
    const upperLip = landmarks[13];
    const lowerLip = landmarks[14];
    const mouthOpen = (lowerLip.y - upperLip.y) > 0.03;

    if (!baselineNoseY) baselineNoseY = nose.y;
    const noseRise = baselineNoseY - nose.y; // Positive when head tilts back

    if (mouthOpen) {
      action = "🛡️ Shield Up!";
    } else if (noseRise > 0.02 && !jumpCooldown) {
      action = "🦘 Jump!";
      jump();
      jumpCooldown = true;
      setTimeout(() => (jumpCooldown = false), 800);
    } else {
      action = "😐 Idle";
    }

    document.getElementById("status").textContent = action;
  }

  if (!gameOver) requestAnimationFrame(detectLoop);
}

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
  // Add gravity
  player.vy += GRAVITY;
  player.y += player.vy;
  if (player.y >= ground - player.h) {
    player.y = ground - player.h;
    player.vy = 0;
    player.onGround = true;
  }

  // Scroll environment
  if (Math.random() < 0.02) obstacles.push({ x: canvas.width, y: ground - 20, w: 20, h: 20 });
  if (Math.random() < 0.01) gaps.push({ x: canvas.width, w: 60 });

  obstacles.forEach(o => o.x -= SCROLL_SPEED);
  gaps.forEach(g => g.x -= SCROLL_SPEED);

  // Collision & falling into gaps
  for (const o of obstacles) {
    if (player.x < o.x + o.w && player.x + player.w > o.x && player.y + player.h > o.y) {
      endGame();
    }
  }

  const inGap = gaps.some(g => player.x + player.w > g.x && player.x < g.x + g.w);
  if (inGap && player.onGround) {
    endGame();
  }

  // Remove old items
  obstacles = obstacles.filter(o => o.x + o.w > 0);
  gaps = gaps.filter(g => g.x + g.w > 0);

  score += dt * 10; // Increase score by time
  document.getElementById("status").textContent = `${action} | Score: ${Math.floor(score)}`;
}

function drawGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Draw ground
  ctx.fillStyle = "#555";
  ctx.fillRect(0, ground, canvas.width, 40);

  // Draw player
  ctx.fillStyle = "#0f0";
  ctx.fillRect(player.x, player.y, player.w, player.h);

  // Draw obstacles
  ctx.fillStyle = "#f00";
  for (const o of obstacles) ctx.fillRect(o.x, o.y, o.w, o.h);

  // Draw gaps (as black holes)
  ctx.fillStyle = "#111";
  for (const g of gaps) ctx.fillRect(g.x, ground, g.w, 40);
}

init();
