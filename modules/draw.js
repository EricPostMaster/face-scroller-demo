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
  // player: draw as a simple walking person (head, torso, limbs). Uses player.stepPhase
  // stepPhase should be provided by the game loop (seconds-based phase)
  const stepPhase = opts.stepPhase || 0;
  // handle selection screen first
  const selection = opts.selection || null;
  if (selection && selection.active) {
    drawSelectionScreen(ctx, canvas, selection);
    return; // skip drawing game elements until a player is chosen
  }

  // prefer sprite if available
  const usedSprite = (player.sprite && drawPlayerSprite(ctx, player, {
    stepPhase,
    fps: opts.SPRITE_FPS || 12,
    frameW: player.sprite ? player.sprite.frameW : 20,
    frameH: player.sprite ? player.sprite.frameH : 32,
    cols: player.sprite ? player.sprite.cols : 4,
    walkRow: 0 // single-row sheet; walk frames are on row 0
  }));
  if (!usedSprite) {
    drawPlayerPerson(ctx, player.x, player.y, player.w, player.h, stepPhase, {
      powerUpActive, wingsActive, shoeActive, RAINBOW_HUE_SPEED, RAINBOW_PULSE_SPEED
    });
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

function drawSelectionScreen(ctx, canvas, selection) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  // support multiple selection modes
  const mode = selection.mode || 'character'; // 'character' or 'postDeath'
  if (mode === 'character') {
    ctx.fillText('Select Player', canvas.width / 2, 40);
  } else if (mode === 'postDeath') {
    ctx.fillText('Choose an option', canvas.width / 2, 40);
  }

  // draw two character choices centered horizontally
  const sprites = selection.sprites || [];
  const choiceY = canvas.height / 2 - 10;
  const spacing = 120;
  const cx = canvas.width / 2 - spacing / 2;

  for (let i = 0; i < 2; i++) {
    const sx = cx + i * spacing;
    // draw a card
    ctx.fillStyle = '#222';
    ctx.fillRect(sx - 40, choiceY - 40, 80, 100);
    // draw sprite if available
    const s = sprites[i];
    if (mode === 'character') {
      if (s && s.image) {
        // draw first walk frame scaled to 40x56
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(s.image, 0, 0, s.frameW, s.frameH, sx - 20, choiceY - 20, 40, 56);
      } else {
        // fallback humanoid box
        ctx.fillStyle = '#4af';
        ctx.fillRect(sx - 12, choiceY - 20, 24, 40);
      }
    } else if (mode === 'postDeath') {
      // draw emojis for the post-death choices
      const emojis = selection.postDeathEmojis || ['🏃‍➡️', '🔁'];
      ctx.fillStyle = '#fff';
      ctx.font = '28px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emojis[i] || '', sx, choiceY - 4);
    }
    ctx.fillStyle = '#fff';
    // label differs by mode; for postDeath reduce font and move down to avoid overlap with emoji
    if (mode === 'character') {
      ctx.font = '14px sans-serif';
      ctx.fillText(`Player ${i + 1}`, sx, choiceY + 50);
    } else if (mode === 'postDeath') {
      ctx.font = '12px sans-serif';
      const labels = selection.postDeathLabels || ['Run Again', 'Start Over'];
      ctx.fillText(labels[i] || `Option ${i+1}`, sx, choiceY + 62);
    }
  }

  // draw red nose dot (cursor)
  ctx.fillStyle = 'red';
  ctx.beginPath(); ctx.arc(selection.dotX, selection.dotY, 5, 0, Math.PI * 2); ctx.fill();

  // draw hover progress indicator if provided
  // selection.hoverIndex indicates which card is being hovered; hoverProgress is 0..1
  const hoverIndex = (typeof selection.hoverIndex === 'number') ? selection.hoverIndex : null;
  const hoverProgress = (typeof selection.hoverProgress === 'number') ? selection.hoverProgress : 0;
  if (hoverIndex !== null) {
    const sx = cx + hoverIndex * spacing;
    const rect = { x: sx - 40, y: choiceY - 40, w: 80, h: 100 };
    // highlight hovered card
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    // draw a circular progress ring in the top-right of the card
    const ringCX = rect.x + rect.w - 12;
    const ringCY = rect.y + 12;
    const radius = 8;
    // background ring
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ringCX, ringCY, radius, 0, Math.PI * 2); ctx.stroke();
    // progress arc
    ctx.strokeStyle = 'rgba(255,200,50,0.95)';
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.arc(ringCX, ringCY, radius, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * hoverProgress);
    ctx.stroke();
    // optional text percent
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pct = Math.floor(hoverProgress * 100);
    ctx.fillText(pct + '%', ringCX, ringCY);
  }

  // draw instruction text for character selection
  if (mode === 'character') {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Hover nose + open mouth for 1s to select', canvas.width / 2, canvas.height - 24);
  } else if (mode === 'postDeath') {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Hover nose + open mouth for 1s to choose', canvas.width / 2, canvas.height - 24);
  }
}

// Draw a simple stylized person with walking legs/arms
function drawPlayerPerson(ctx, x, y, w, h, phase, opts = {}) {
  const { powerUpActive, wingsActive, shoeActive, RAINBOW_HUE_SPEED, RAINBOW_PULSE_SPEED } = opts;
  // compute colors (rainbow pulse when power-up active)
  let fillStyle = '#4af';
  let strokeStyle = '#003';
  if (powerUpActive) {
    const now = performance.now();
    const hue = (now / RAINBOW_HUE_SPEED * 360) % 360;
    const pulse = 0.6 + 0.4 * Math.sin(now / RAINBOW_PULSE_SPEED);
    fillStyle = `hsl(${hue},90%,${50 * pulse}%)`;
    strokeStyle = `hsla(${hue},90%,60%,0.9)`;
  }

  ctx.save();
  const cx = x + w / 2;
  const bottomY = y + h; // ground-level for this player's box

  // layout fractions so head + torso + legs fit exactly in h
  const headFrac = 0.34; // head diameter fraction of total height
  const neckFrac = 0.02;
  const torsoFrac = 0.34;
  const headDia = Math.max(4, h * headFrac);
  const headR = headDia / 2;
  const headCY = y + headR + 1; // small visual offset

  const torsoTopY = y + headDia + h * neckFrac;
  const torsoH = Math.max(4, h * torsoFrac);
  const torsoBottomY = torsoTopY + torsoH;

  // legs: compute length so their ends reach bottomY
  const legAttachY = torsoBottomY;
  const legLen = Math.max(2, bottomY - legAttachY);

  // swings
  const legSwing = Math.sin(phase * 2) * 0.9;
  const legAngleA = legSwing * 0.7;
  const legAngleB = -legSwing * 0.7;
  const armSwing = Math.sin(phase * 2 + Math.PI) * 0.8;
  const armAngleA = armSwing * 0.6;
  const armAngleB = -armSwing * 0.6;

  // draw head
  ctx.beginPath();
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1.6;
  ctx.arc(cx, headCY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // eyes
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.beginPath(); ctx.arc(cx - headR*0.28, headCY - headR*0.08, Math.max(1, headR*0.09), 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + headR*0.28, headCY - headR*0.08, Math.max(1, headR*0.09), 0, Math.PI*2); ctx.fill();

  // torso
  ctx.beginPath();
  ctx.fillStyle = fillStyle;
  ctx.fillRect(cx - w*0.22, torsoTopY, w*0.44, torsoH);
  ctx.strokeRect(cx - w*0.22, torsoTopY, w*0.44, torsoH);

  // limb helper
  function drawLimb(ax, ay, angle, length, width, color) {
    ctx.beginPath();
    ctx.lineWidth = width;
    // default limb color should match the body fill so arms/legs share the same blue
    ctx.strokeStyle = color || fillStyle;
    ctx.lineCap = 'round';
    const bx = ax + Math.cos(angle) * length;
    const by = ay + Math.sin(angle) * length;
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    return { x: bx, y: by };
  }

  // arms
  const armAttachY = torsoTopY + torsoH * 0.18;
  const armLen = torsoH * 0.9;
  const leftArm = drawLimb(cx - w*0.22, armAttachY, Math.PI/2 + armAngleA, armLen, 3);
  const rightArm = drawLimb(cx + w*0.22, armAttachY, Math.PI/2 + armAngleB, armLen, 3);

  // legs (attach at torso bottom and reach bottomY)
  const leftLeg = drawLimb(cx - w*0.12, legAttachY, Math.PI/2 + legAngleA, legLen, 3);
  const rightLeg = drawLimb(cx + w*0.12, legAttachY, Math.PI/2 + legAngleB, legLen, 3);

  // shoes (clamp foot Y to bottomY)
  const leftFootY = Math.min(leftLeg.y, bottomY);
  const rightFootY = Math.min(rightLeg.y, bottomY);
  ctx.fillStyle = shoeActive ? '#ffcc80' : '#222';
  ctx.beginPath(); ctx.ellipse(leftLeg.x, leftFootY, Math.max(2, w*0.16), Math.max(1.8, h*0.06), 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(rightLeg.x, rightFootY, Math.max(2, w*0.16), Math.max(1.8, h*0.06), 0, 0, Math.PI*2); ctx.fill();

  ctx.restore();
}

// Draw sprite-based player. Returns true if drawn, false if not (e.g., no sprite)
function drawPlayerSprite(ctx, player, opts = {}) {
  const s = player.sprite;
  if (!s || !s.image) return false;
  const stepPhase = opts.stepPhase || 0;
  const fps = opts.fps || 12;
  const frameW = opts.frameW || s.frameW;
  const frameH = opts.frameH || s.frameH;
  const cols = opts.cols || s.cols || Math.floor(s.width / frameW);
  const walkRow = (typeof opts.walkRow === 'number') ? opts.walkRow : 1;

  ctx.save();
  ctx.imageSmoothingEnabled = false; // keep pixel art crisp

  // choose row: if airborne use a dedicated jump row (if present), otherwise use walkRow
  const hasJumpRow = (s.rows || 0) > 2; // row index 2 exists
  const row = player.onGround ? walkRow : (hasJumpRow ? 2 : walkRow);

  // compute frame index from stepPhase; if airborne and using jump row, pick frame 0
  const frameCount = Math.max(1, cols);
  let frameIndex = 0;
  if (player.onGround) {
    frameIndex = Math.floor(stepPhase * fps) % frameCount;
  } else {
    frameIndex = hasJumpRow ? 0 : Math.floor(stepPhase * fps) % frameCount;
  }

  // compute source and destination; ensure sprite feet align to player's bottom
  const sx = frameIndex * frameW;
  const sy = row * frameH;
  const dw = player.w;
  const dh = player.h;

  // pick frame box metadata (content bbox) to center the visible sprite horizontally
  const frameBoxes = s.frameBoxes || [];
  const fb = frameBoxes[row * cols + frameIndex] || { contentCenterX: frameW / 2, contentBottomY: frameH - 1 };

  // compute horizontal offset so content center maps to player's center
  const contentCenterX = fb.contentCenterX;
  const desiredCenterX = player.x + player.w / 2;
  // when drawing the whole frame scaled to dw, contentCenterX maps to sx + contentCenterX scaled
  const scaleX = dw / frameW;
  const scaleY = dh / frameH;

  // compute a dx so the scaled contentCenterX lands at desiredCenterX
  const dx = desiredCenterX - (contentCenterX * scaleX);

  // compute vertical draw position so the content bottom aligns to player's bottom
  const contentBottomY = fb.contentBottomY;
  const desiredBottomY = player.y + player.h;
  const dy = desiredBottomY - (contentBottomY * scaleY);

  // flip for facing depending on sheet defaultFacing vs player.facing
  const sheetFacesLeft = !!(s.defaultFacing && s.defaultFacing === 'left');
  const wantFlip = (player.facing === 'right' && sheetFacesLeft) || (player.facing === 'left' && !sheetFacesLeft);
  if (wantFlip) {
    // flip around player's center
    ctx.translate(player.x + dw / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(player.x + dw / 2), 0);
    // when flipped, dx should be recomputed relative to the flipped canvas; easiest is to draw using dx as is because flip handled above
  }

  ctx.drawImage(s.image, sx, sy, frameW, frameH, dx, dy, dw, dh);
  ctx.restore();
  return true;
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
