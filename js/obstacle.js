/* ============================================================
 * 冰场小游戏 02：躲障碍
 *
 * 事件：键盘 ← → / A D 控制左右，或者直接在冰面上拖拽；空格开始。
 * 数据：人物的横向位置 + 速度（vx），锥子的位置和下落速度。
 * 规则：锥子从上方落下，速度随滑行距离变快、间隔变短；
 *       人物用"加速度"推动，松手会慢慢滑停 —— 所以提前量比猛推更重要。
 * 输出：撞到就结束，成绩是滑过的米数，最好成绩存在浏览器里。
 * ============================================================ */
(function () {
  'use strict';

  var stage = document.getElementById('game-stage');
  var canvas = document.getElementById('game-canvas');
  if (!stage || !canvas) return;

  var ctx = canvas.getContext('2d');
  var overlay = document.getElementById('game-overlay');
  var elEyebrow = document.getElementById('game-eyebrow');
  var elTitle = document.getElementById('game-title');
  var elText = document.getElementById('game-text');
  var elStart = document.getElementById('game-start');
  var elDist = document.getElementById('game-dist');
  var elBest = document.getElementById('game-best');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 0, H = 0, DPR = 1;
  var bgCanvas = document.createElement('canvas');

  var state = 'idle';                 // idle | run | over
  var player = { x: 0, vx: 0, tx: null, lean: 0, face: 1 };
  var cones = [], bits = [];
  var dist = 0, speed = 0, travel = 0, spawnIn = 0, shake = 0, flash = 0;
  var shownM = -1;
  var pointerDown = false;
  var keys = { left: false, right: false };

  var best = 0;
  try { best = parseInt(localStorage.getItem('rinkRunBest') || '0', 10) || 0; } catch (err) { best = 0; }

  /* ---------- 尺寸 ---------- */
  function unit() { return H / 560; }          // 所有尺寸以 560 高为基准缩放
  function playerY() { return H * 0.76; }
  function skaterH() { return Math.min(190, Math.max(96, H * 0.34)); }
  // 宽屏冰场横向很长，横移速度必须跟着画布宽度走，不然根本来不及躲
  function topSpeed() { return Math.max(H * 1.1, W * 0.72); }
  function accel() { return topSpeed() * 5.2; }

  function fit() {
    var r = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!player.x) player.x = W * 0.5;
    player.x = Math.max(30, Math.min(W - 30, player.x));
    paintBg();
    draw();
  }

  /* ---------- 冰面背景（尺寸变化时重画一次，之后每帧贴图） ---------- */
  function paintBg() {
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    var g = bgCanvas.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, W, H);

    var lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#170D0C');
    lg.addColorStop(0.5, '#120A0A');
    lg.addColorStop(1, '#0A0606');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);

    // 上方的顶光，越远越亮一点，暗示纵深
    var rg = g.createRadialGradient(W * 0.5, -H * 0.25, 10, W * 0.5, -H * 0.25, H * 1.2);
    rg.addColorStop(0, 'rgba(255,206,190,0.13)');
    rg.addColorStop(0.45, 'rgba(255,140,110,0.045)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);

    // 两侧挡板
    var bw = Math.max(10, W * 0.028);
    for (var side = 0; side < 2; side++) {
      var x0 = side ? W - bw : 0;
      var sg = g.createLinearGradient(x0, 0, x0 + bw, 0);
      if (side) { sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(255,190,170,0.05)'); }
      else { sg.addColorStop(0, 'rgba(255,190,170,0.05)'); sg.addColorStop(1, 'rgba(0,0,0,0.55)'); }
      g.fillStyle = sg;
      g.fillRect(x0, 0, bw, H);
      g.strokeStyle = 'rgba(255,224,212,0.10)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(side ? W - bw + 0.5 : bw - 0.5, 0);
      g.lineTo(side ? W - bw + 0.5 : bw - 0.5, H);
      g.stroke();
    }

    // 底部压暗，人物所在的近处像前景，画面有纵深
    var vg = g.createLinearGradient(0, H * 0.45, 0, H);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, H * 0.45, W, H * 0.55);

    // 冰面本身的旧划痕
    g.strokeStyle = 'rgba(255,236,230,0.03)';
    for (var i = 0; i < 14; i++) {
      g.lineWidth = 0.8 + Math.random() * 1.2;
      g.beginPath();
      var y0 = Math.random() * H;
      g.moveTo(0, y0);
      g.bezierCurveTo(W * 0.3, y0 + 20, W * 0.7, y0 - 20, W, y0 + 6);
      g.stroke();
    }
  }

  /* ---------- 开局 / 结束 ---------- */
  function start() {
    if (state === 'run') return;
    cones.length = 0;
    bits.length = 0;
    dist = 0;
    travel = 0;
    speed = H * 0.5;
    spawnIn = 0.5;
    shake = 0;
    flash = 0;
    shownM = -1;
    player.x = W * 0.5;
    player.vx = 0;
    player.tx = null;
    player.lean = 0;
    state = 'run';
    overlay.hidden = true;
    stage.classList.add('is-running');
    elEyebrow.textContent = 'Rink 02 · Obstacle run';
    elDist.textContent = '0 m';
    last = 0;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function over() {
    state = 'over';
    var m = Math.round(dist / 50);
    var wasBest = m > best;
    if (wasBest) {
      best = m;
      try { localStorage.setItem('rinkRunBest', String(best)); } catch (err) {}
    }
    shake = reduce ? 0 : 16;
    flash = reduce ? 0 : 0.9;
    burst(player.x, playerY() - skaterH() * 0.35, 26);

    elBest.textContent = best + ' m';
    elDist.textContent = m + ' m';
    elEyebrow.textContent = 'Rink 02 · Run over';
    elTitle.textContent = 'DOWN YOU GO';
    elText.innerHTML = wasBest && m > 0
      ? 'A pylon caught you at <b>' + m + ' m</b> — that is your best run so far.'
      : 'A pylon caught you at <b>' + m + ' m</b>. Best is ' + best + ' m.';
    elStart.textContent = 'Skate again';
    overlay.hidden = false;
    stage.classList.remove('is-running');
    draw();
  }

  /* ---------- 锥子 ---------- */
  function spawn() {
    var r = Math.max(12, Math.min(24, H * 0.033));
    // 偶尔来一组"门"：两个锥子中间留一条缝，逼你选边
    if (Math.random() < 0.22 && W > 430) {
      var gap = Math.max(130, W * 0.2);
      var gx = 40 + Math.random() * Math.max(1, W - 80 - gap);
      cones.push({ x: gx, y: -60, r: r });
      cones.push({ x: gx + gap, y: -60, r: r });
      return;
    }
    cones.push({ x: 40 + Math.random() * (W - 80), y: -60, r: r });
  }

  function nextGap() {
    var t = Math.max(0.34, 0.72 - dist / (H * 14));
    return t * (0.85 + Math.random() * 0.3);
  }

  function drawCone(c) {
    var h = c.r * 2.7;
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.r * 1.3, c.r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // 锥体
    var g = ctx.createLinearGradient(c.x - c.r, 0, c.x + c.r, 0);
    g.addColorStop(0, '#E0712F');
    g.addColorStop(0.45, '#FFB764');
    g.addColorStop(1, '#C8551F');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - h);
    ctx.lineTo(c.x + c.r, c.y);
    ctx.lineTo(c.x - c.r, c.y);
    ctx.closePath();
    ctx.fill();

    // 反光条
    var bandY = c.y - h * 0.52;
    var bandW = c.r * 0.52;
    ctx.fillStyle = 'rgba(255,246,235,0.92)';
    ctx.beginPath();
    ctx.moveTo(c.x - bandW, bandY);
    ctx.lineTo(c.x + bandW, bandY);
    ctx.lineTo(c.x + bandW * 1.18, bandY + c.r * 0.42);
    ctx.lineTo(c.x - bandW * 1.18, bandY + c.r * 0.42);
    ctx.closePath();
    ctx.fill();

    // 底座
    ctx.fillStyle = '#8F3D16';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(c.x - c.r * 1.2, c.y - c.r * 0.22, c.r * 2.4, c.r * 0.5, c.r * 0.2)
                  : ctx.rect(c.x - c.r * 1.2, c.y - c.r * 0.22, c.r * 2.4, c.r * 0.5);
    ctx.fill();

    // 冰刀下的暖光反射一点点
    ctx.fillStyle = 'rgba(255,180,120,0.10)';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + c.r * 0.3, c.r * 1.5, c.r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------- 冰屑 ---------- */
  function burst(x, y, n) {
    if (reduce) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = 40 + Math.random() * 220;
      bits.push({
        x: x, y: y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 40,
        r: 0.8 + Math.random() * 2.2,
        life: 0.4 + Math.random() * 0.5,
        t: 0
      });
    }
  }

  function spray() {
    if (reduce) return;
    var n = Math.abs(player.vx) > H * 0.3 ? 2 : 1;
    for (var i = 0; i < n; i++) {
      bits.push({
        x: player.x + (Math.random() - 0.5) * 10,
        y: playerY() - 3,
        vx: -player.vx * 0.22 + (Math.random() - 0.5) * 60,
        vy: -(20 + Math.random() * 90),
        r: 0.7 + Math.random() * 1.6,
        life: 0.35 + Math.random() * 0.4,
        t: 0
      });
    }
    if (bits.length > 220) bits.splice(0, bits.length - 220);
  }

  /* ---------- 更新 ---------- */
  function update(dt) {
    dist += speed * dt;
    travel += speed * dt;
    speed = Math.min(H * 1.6, H * 0.5 * (1 + dist / (H * 4.2)));

    // 左右：有按键用加速度推，松手滑停；拖拽则往手指方向吸
    var dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir) {
      player.tx = null;
      player.vx += dir * accel() * dt;
    } else if (player.tx != null) {
      player.vx += (player.tx - player.x) * 40 * dt;
      player.vx *= Math.pow(0.02, dt);
    } else {
      player.vx *= Math.pow(0.0008, dt);
    }
    var mv = topSpeed();
    player.vx = Math.max(-mv, Math.min(mv, player.vx));
    player.x += player.vx * dt;

    // 挡板：滑到边上就停住，不许出界
    var pad = Math.max(26, W * 0.028) + 18;
    if (player.x < pad) { player.x = pad; player.vx = Math.abs(player.vx) * 0.15; }
    if (player.x > W - pad) { player.x = W - pad; player.vx = -Math.abs(player.vx) * 0.15; }

    if (Math.abs(player.vx) > 24) player.face = player.vx > 0 ? 1 : -1;
    var leanTarget = Math.max(-0.34, Math.min(0.34, player.vx / (H * 0.85)));
    player.lean += (leanTarget - player.lean) * Math.min(1, dt * 10);

    // 锥子
    spawnIn -= dt;
    if (spawnIn <= 0) { spawn(); spawnIn = nextGap(); }
    for (var i = cones.length - 1; i >= 0; i--) {
      cones[i].y += speed * dt;
      if (cones[i].y > H + 70) cones.splice(i, 1);
    }

    spray();

    // 冰屑
    for (var b = bits.length - 1; b >= 0; b--) {
      var p = bits[b];
      p.t += dt;
      if (p.t >= p.life) { bits.splice(b, 1); continue; }
      p.vy += 320 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    shake *= Math.pow(0.02, dt);
    flash *= Math.pow(0.004, dt);
    if (shake < 0.4) shake = 0;

    checkHit();

    var m = Math.round(dist / 50);
    if (m !== shownM) { shownM = m; elDist.textContent = m + ' m'; }
  }

  function checkHit() {
    var py = playerY();
    var halfW = 15 * unit() + 6;
    for (var i = 0; i < cones.length; i++) {
      var c = cones[i];
      if (c.y < py - 46 * unit() || c.y > py + 12 * unit()) continue;
      if (Math.abs(c.x - player.x) < c.r + halfW) { over(); return; }
    }
  }

  /* ---------- 绘制 ---------- */
  function draw() {
    ctx.save();
    if (shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    ctx.clearRect(-24, -24, W + 48, H + 48);
    ctx.drawImage(bgCanvas, 0, 0, W, H);

    // 冰面向后流动的横线：速度感主要靠它
    var step = 150 * unit();
    var off = travel % step;
    ctx.strokeStyle = 'rgba(255,224,212,0.075)';
    ctx.lineWidth = 1;
    for (var y = off - step; y < H + step; y += step) {
      if (y < 0) continue;
      ctx.beginPath();
      ctx.moveTo(Math.max(0, W * 0.028), y);
      ctx.lineTo(W - Math.max(0, W * 0.028), y);
      ctx.stroke();
    }

    for (var i = 0; i < cones.length; i++) drawCone(cones[i]);

    for (var b = 0; b < bits.length; b++) {
      var p = bits[b];
      var a = 1 - p.t / p.life;
      ctx.fillStyle = 'rgba(255,242,236,' + (a * 0.8).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 还没开始滑的时候不画人，让开场就是一张干净的冰面标题卡
    if (state !== 'idle') {
      SkaterPose.draw(ctx, player.x, playerY(), skaterH(), player.lean, player.face,
                      { glow: 'rgba(255,120,90,0.45)', blur: 8 });
    }
    ctx.restore();

    if (flash > 0.01) {
      ctx.fillStyle = 'rgba(255,90,70,' + (flash * 0.26).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- 主循环 ---------- */
  var raf = 0, last = 0;

  function loop(ts) {
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    if (state === 'run') update(dt);
    draw();
    if (state === 'run' || bits.length || shake > 0.4) {
      raf = requestAnimationFrame(loop);
    } else {
      raf = 0;
      last = 0;
    }
  }

  /* ---------- 输入 ---------- */
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      keys.left = true;
      if (state === 'run') e.preventDefault();
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      keys.right = true;
      if (state === 'run') e.preventDefault();
    } else if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      if (state !== 'run') { e.preventDefault(); start(); }
    }
  });

  window.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  });

  function localX(e) {
    var r = canvas.getBoundingClientRect();
    return Math.max(20, Math.min(W - 20, e.clientX - r.left));
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (state !== 'run') return;
    e.preventDefault();
    pointerDown = true;
    player.tx = localX(e);
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!pointerDown || state !== 'run') return;
    e.preventDefault();
    player.tx = localX(e);
  });

  window.addEventListener('pointerup', function () {
    pointerDown = false;      // 手指抬起后不再跟随，但保留最后一个目标点，让他滑到位
  });

  if (elStart) elStart.addEventListener('click', start);

  // 离开标签页再回来时，别让一帧把时间全吃进去
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      keys.left = keys.right = false;
      if (state === 'run') {
        state = 'idle';
        elEyebrow.textContent = 'Rink 02 · Paused';
        elTitle.textContent = 'PAUSED';
        elText.textContent = 'You left the rink for a moment. Start a new run when you are back.';
        elStart.textContent = 'Skate again';
        overlay.hidden = false;
        stage.classList.remove('is-running');
      }
    }
    last = 0;
  });

  /* ---------- 尺寸变化 ---------- */
  var rt = 0;
  function scheduleFit() {
    clearTimeout(rt);
    rt = setTimeout(fit, 120);
  }
  if (window.ResizeObserver) new ResizeObserver(scheduleFit).observe(stage);
  else window.addEventListener('resize', scheduleFit);
  window.addEventListener('orientationchange', scheduleFit);

  elBest.textContent = best + ' m';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fit);
  } else {
    fit();
  }
})();
