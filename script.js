let video, faceLandmarker, runningMode = "VIDEO";
let canvas, ctx;
let player, floorY, gravity = 0.8, jumpStrength = 12;
let obstacles = [], gaps = [];
let gameSpeed = 5, score = 0, gameOver = false;
let shieldActive = false, shieldEnergy = 3, shieldCooldown = false;
let baselineY = 0, jumpThreshold = -15; // relative movement threshold
let lastNoseY = null;
let lastVideoTime = -1;
let noseYVisual = 0;

async function init() {
  const { FaceLandmarker, FilesetResolver } = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9"
  );

  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
    },
    runningMode,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  });

  video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
    video.srcObject = stream;
  });

  canvas = document.getElementById("gameCanvas");
  ctx = canvas.getContext("2d");

  floorY = canvas.height - 50;
  player = { x: 80, y: floorY - 50, width: 40, height: 50, dy: 0, onGround: true };

  generateLevel();
  requestAnimationFrame(gameLoop);
}

function generateLevel() {
  obstacles = [];
  gaps = [];
  let x = 300;

  while (x < 5000) {
    // Ensure at least 2 player widths between gaps
    if (Math.random() < 0.2) {
      const gapWidth = Math.random() * 2 * player.width + player.width; // up to 3 widths
      gaps.push({ x, width: gapWidth });
      x += gapWidth + 2 * player.width;
    } else if (Math.random() < 0.2) {
      // Red obstacles, only on solid ground
      obstacles.push({ x, y: floorY - 50, width: 30, height: 50 });
      x += 200;
    } else {
      x += 150;
    }
  }
}

function gameLoop(time) {
  if (!faceLandmarker || !video.readyState) return requestAnimationFrame(gameLoop);

  if (lastVideoTime === video.currentTime) {
    requestAnimationFrame(gameLoop);
    return;
  }
  lastVideoTime = video.currentTime;

  const faceLandmarks = faceLandmarker.detectForVideo(video, performance.now());
  updateGame(faceLandmarks);
  drawGame();

  if (!gameOver) requestAnimationFrame(gameLoop);
}

function updateGame(result) {
  if (result?.faceLandmarks?.length) {
    const nose = result.faceLandmarks[0][1]; // nose tip
    if (lastNoseY === null) lastNoseY = nose.y;
    const deltaY = (nose.y - lastNoseY) * 1000;
    noseYVisual = deltaY;
    lastNoseY = nose.y;

    // Jump if head tipped back past threshold
    if (deltaY < jumpThreshold && player.onGround) {
      player.dy = -jumpStrength;
      player.onGround = false;
    }

    // Shield if mouth open
    const upperLip = result.faceLandmarks[0][13];
    const lowerLip = result.faceLandmarks[0][14];
    const mouthOpen = (lowerLip.y - upperLip.y) > 0.02;

    if (mouthOpen && shieldEnergy > 0 && !shieldCooldown) {
      shieldActive = true;
      shieldEnergy -= 0.02; // drains steadily
      if (shieldEnergy <= 0) {
        shieldActive = false;
        shieldCooldown = true;
        setTimeout(() => {
          shieldEnergy = 3;
          shieldCooldown = false;
        }, 5000);
      }
    } else {
      shieldActive = false;
    }
  }

  player.y += player.dy;
  player.dy += gravity;

  // Ground collision with gaps
  const playerBottom = player.y + player.height;
  const playerLeft = player.x;
  const playerRight = player.x + player.width;

  let grounded = false;
  if (playerBottom >= floorY) {
    grounded = true;
  } else {
    for (const gap of gaps) {
      if (playerRight > gap.x && playerLeft < gap.x + gap.width) {
        grounded = false;
        break;
      }
      grounded = true;
    }
  }

  if (grounded) {
    player.y = floorY - player.height;
    player.dy = 0;
    player.onGround = true;
  }

  // Move level
  for (let obs of obstacles) obs.x -= gameSpeed;
  for (let gap of gaps) gap.x -= gameSpeed;

  // Collisions
  for (let obs of obstacles) {
    if (rectsOverlap(player, obs)) {
      if (!shieldActive) endGame();
    }
  }

  if (player.y > canvas.height) endGame();

  if (!gameOver) score += 1;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function endGame() {
  gameOver = true;
  document.getElementById("tryAgain").style.display = "block";
}

function resetGame() {
  player.y = floorY - player.height;
  player.dy = 0;
  player.onGround = true;
  obstacles = [];
  gaps = [];
  score = 0;
  shieldEnergy = 3;
  gameOver = false;
  generateLevel();
  document.getElementById("tryAgain").style.display = "none";
  requestAnimationFrame(gameLoop);
}

function drawGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Floor
  ctx.fillStyle = "green";
  ctx.fillRect(0, floorY, canvas.width, canvas.height - floorY);

  // Gaps (erase parts of floor)
  ctx.fillStyle = "white";
  for (let gap of gaps) ctx.fillRect(gap.x, floorY, gap.width, canvas.height - floorY);

  // Obstacles
  ctx.fillStyle = "red";
  for (let obs of obstacles) ctx.fillRect(obs.x, obs.y, obs.width, obs.height);

  // Player
  ctx.fillStyle = shieldActive ? "cyan" : "black";
  ctx.fillRect(player.x, player.y, player.width, player.height);

  // Shield bar
  ctx.fillStyle = "gray";
  ctx.fillRect(10, 10, 100, 10);
  ctx.fillStyle = "blue";
  ctx.fillRect(10, 10, (shieldEnergy / 3) * 100, 10);

  // Nose visual indicator
  const centerX = canvas.width / 2;
  const baseY = 60;
  ctx.strokeStyle = "blue";
  ctx.beginPath();
  ctx.moveTo(centerX - 50, baseY);
  ctx.lineTo(centerX + 50, baseY);
  ctx.stroke();

  // Dotted line for jump threshold
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(centerX - 50, baseY + jumpThreshold);
  ctx.lineTo(centerX + 50, baseY + jumpThreshold);
  ctx.stroke();
  ctx.setLineDash([]);

  // Red dot for nose position
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(centerX, baseY + noseYVisual, 4, 0, Math.PI * 2);
  ctx.fill();

  // Score
  ctx.fillStyle = "black";
  ctx.font = "20px sans-serif";
  ctx.fillText("Score: " + score, canvas.width - 120, 30);
}

document.getElementById("tryAgain").addEventListener("click", resetGame);
init();