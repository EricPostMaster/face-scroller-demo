// draw.js
// Exported drawGame function and drawing helpers used by the main game code.
export function drawGame(opts) {
  const {
    ctx, canvas, ground, gaps, obstacles, powerUps, beams, particles, player,
    powerUpActive, powerUpTimeLeft, POWERUP_DURATION,
    shieldActive, shieldTimeLeft, SHIELD_DURATION,
    wingsActive, shoeActive, redCrossActive,
    noseVisualOffset, INDICATOR_BASELINE_Y, INDICATOR_SCALE,
    JUMP_NOSE_THRESHOLD, RAINBOW_HUE_SPEED, RAINBOW_PULSE_SPEED,
    score
  } = opts;

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

  // power-ups (render as emojis for a quick approachable look)
  for (const p of powerUps) {
    if (p.collected) continue;
    drawEmojiPowerUp(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w, p.type);
  }

  // draw active beams
  for (const b of beams) {
    drawBeam(ctx, b.x, b.y);
  }

  // player (rainbow pulse when power-up active)
  if (powerUpActive) {
    const now = performance.now();
    const hue = (now / RAINBOW_HUE_SPEED * 360) % 360;
    const pulse = 0.6 + 0.4 * Math.sin(now / RAINBOW_PULSE_SPEED);
    ctx.fillStyle = `hsl(${hue},90%,${50 * pulse}%)`;
    ctx.fillRect(player.x, player.y, player.w, player.h);
    ctx.strokeStyle = `hsla(${hue},90%,60%,0.9)`;
    ctx.lineWidth = 3;
    ctx.strokeRect(player.x - 2, player.y - 2, player.w + 4, player.h + 4);
  } else {
    ctx.fillStyle = "#4af";
    ctx.fillRect(player.x, player.y, player.w, player.h);
  }

  // wings active visual
  if (wingsActive) {
    const lx = player.x - 6;
    const rx = player.x + player.w + 6;
    const cy = player.y + player.h * 0.35;
    drawSmallWing(ctx, lx, cy, 10, 6);
    drawSmallWing(ctx, rx, cy, 10, 6, true);
  }
  if (shoeActive) drawSmallShoe(ctx, player.x + player.w / 2, player.y + player.h + 6, 12, 8);
  if (redCrossActive) drawRedCrossIcon(ctx, player.x + player.w / 2, player.y - 18, 14);

  // shield visuals
  const barFull = player.w * 1.6;
  if (shieldActive) {
    ctx.strokeStyle = "rgba(0,255,255,0.7)";
    ctx.lineWidth = 3;
    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(player.w, player.h) * 1.6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#0ff";
    const barWidth = barFull * (shieldTimeLeft / SHIELD_DURATION);
    ctx.fillRect(player.x - (barFull - player.w) / 2, player.y - 12, barWidth, 6);
    ctx.strokeStyle = "#003";
    ctx.strokeRect(player.x - (barFull - player.w) / 2, player.y - 12, barFull, 6);
  } else {
    ctx.strokeStyle = "#333";
    ctx.strokeRect(player.x - (barFull - player.w) / 2, player.y - 12, barFull, 6);
  }

  // power-up (star) visual bar
  const powerBarFull = barFull;
  const powerBarX = player.x - (powerBarFull - player.w) / 2;
  const powerBarY = player.y - 20;
  if (powerUpActive) {
    ctx.fillStyle = "#ffd54f";
    const pw = powerBarFull * (powerUpTimeLeft / POWERUP_DURATION);
    ctx.fillRect(powerBarX, powerBarY, pw, 6);
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

  ctx.strokeStyle = "#3aa";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - 60, baselineY);
  ctx.lineTo(centerX + 60, baselineY);
  ctx.stroke();

  const thresholdPx = -JUMP_NOSE_THRESHOLD * INDICATOR_SCALE;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "#3aa";
  ctx.beginPath();
  ctx.moveTo(centerX - 60, baselineY + thresholdPx);
  ctx.lineTo(centerX + 60, baselineY + thresholdPx);
  ctx.stroke();
  ctx.setLineDash([]);

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

// Drawing helpers (copied from original script)
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
  ctx.fillStyle = "#ffd700";
  ctx.fill();
  const g = ctx.createRadialGradient(cx - outerR * 0.2, cy - outerR * 0.35, 2, cx, cy, outerR * 1.2);
  g.addColorStop(0, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.15)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function drawEmojiPowerUp(ctx, cx, cy, size, type) {
  let emoji = '\u2b50';
  if (type === 'wings') emoji = '\ud83e\udebd';
  else if (type === 'shoe') emoji = '\ud83d\udc5f';
  else if (type === 'freeze') emoji = '\ud83e\uddca';
  else if (type === 'redcross') emoji = '\u2795';
  else if (type === 'star') emoji = '\u2b50';
  const fontSize = Math.max(14, Math.floor(size * 1.1));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#fff';
  ctx.fillText(emoji, cx, cy + 1);
  ctx.restore();
}

function drawSkeleton(ctx, x, y, w, h, phase = 0) {
  ctx.save();
  const UW = 20, UH = 32;
  ctx.translate(x, y);
  const sx = w / UW;
  const sy = h / UH;
  ctx.scale(sx, sy);
  const bob = Math.sin(phase * 2) * 1.4;
  ctx.translate(0, bob);
  const boneFill = "#fff";
  const boneStroke = "#111";
  ctx.fillStyle = boneFill;
  ctx.beginPath();
  ctx.ellipse(10, 6, 6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(7, 10, 6, 3);
  ctx.fillStyle = boneStroke;
  ctx.beginPath(); ctx.ellipse(8, 6, 1.6, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(12, 6, 1.6, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(10, 8); ctx.lineTo(9, 9.2); ctx.lineTo(11, 9.2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = boneFill;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(10, 13);
  ctx.lineTo(10, 18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6, 15); ctx.lineTo(14, 15);
  ctx.moveTo(6.5, 17); ctx.lineTo(13.5, 17);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(8.5, 19); ctx.lineTo(11.5, 19);
  ctx.stroke();
  const legSwing = Math.sin(phase) * 5;
  const legLift = Math.max(0, Math.sin(phase)) * 3;
  const armSwing = Math.sin(phase + Math.PI) * 4;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(10, 19);
  ctx.lineTo(10 - 3 + legSwing, 26 + legLift);
  ctx.moveTo(10, 19);
  ctx.lineTo(10 + 3 + -legSwing, 26 + Math.max(0, -Math.sin(phase)) * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(7.5 + legSwing, 27.5); ctx.lineTo(9 + legSwing, 27.5);
  ctx.moveTo(11 + -legSwing, 27.5); ctx.lineTo(12.5 + -legSwing, 27.5);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(10, 14);
  ctx.lineTo(10 - 5 + armSwing, 16 + (Math.sin(phase) * 1.2));
  ctx.moveTo(10, 14);
  ctx.lineTo(10 + 5 + -armSwing, 16 + (Math.sin(phase + Math.PI) * 1.2));
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.ellipse(10, 6, 6, 5, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawWingsIcon(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size / 40;
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.bezierCurveTo(-22, -6, -26, -18, -14, -22);
  ctx.bezierCurveTo(-6, -18, -2, -12, 0, -8);
  ctx.fillStyle = '#9be7ff';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.bezierCurveTo(22, -6, 26, -18, 14, -22);
  ctx.bezierCurveTo(6, -18, 2, -12, 0, -8);
  ctx.fillStyle = '#9be7ff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(10,80,90,0.6)';
  ctx.lineWidth = 2 / s;
  ctx.stroke();
  ctx.restore();
}

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

function drawFreezeGunIcon(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size / 40;
  ctx.scale(s, s);
  ctx.fillStyle = '#7fc9ff';
  ctx.fillRect(-10, -4, 18, 8);
  ctx.fillStyle = '#5fb0ff';
  ctx.fillRect(8, -3, 6, 6);
  ctx.fillStyle = '#3f7fb0';
  ctx.fillRect(-12, 2, 6, 6);
  ctx.restore();
}

function drawBeam(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = 'rgba(160,220,255,0.95)';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(140,200,255,0.65)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 18, y - 4);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(200,240,255,1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 18, y - 4);
  ctx.stroke();
  ctx.restore();
}

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
