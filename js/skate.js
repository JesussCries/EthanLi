/* ============================================================
 * 冰场小游戏：访客画一条线，人物沿着这条线滑过去
 *
 * 事件：pointerdown 按下（开始画）→ pointermove 拖动（记录点）→ pointerup 松开（出发）
 * 数据：指针经过的坐标。存成 0–1 的相对值，所以窗口缩放后路线不会错位。
 * 规则：把点重新等距采样，再按"已滑过的长度"前进 —— 这样速度才均匀，
 *       不会因为手快的地方点稀疏就跑得快。朝向由相邻两点算出，转弯越急身体越倾斜。
 * 输出：冰面刀痕 + 人物剪影的位置、朝向、倾斜角。
 * ============================================================ */
(function () {
  'use strict';

  var stage = document.getElementById('rink-stage');
  var canvas = document.getElementById('rink-canvas');
  if (!stage || !canvas) return;

  var ctx = canvas.getContext('2d');
  var hintEl = document.getElementById('rink-hint');
  var distEl = document.getElementById('rink-dist');
  var demoBtn = document.getElementById('rink-demo');
  var clearBtn = document.getElementById('rink-clear');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 0, H = 0;
  var bgCanvas = document.createElement('canvas');

  var live = [];          // 正在画的点（像素坐标）
  var traces = [];        // 画完的路线，留作冰面刻痕（相对坐标）
  var skater = null;      // 正在滑的状态
  var sparks = [];        // 冰屑
  var drawing = false;

  var SPEED = 430;        // 滑行速度 px/s
  var STEP = 4;           // 重采样间距 px
  var MIN_LEN = 70;       // 太短的线当误触丢掉

  /* ---------- 尺寸 ---------- */
  function fit() {
    var r = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintBg(dpr);
    draw();
  }

  /* ---------- 冰面背景（只在尺寸变化时重画一次，之后每帧直接贴图） ---------- */
  function paintBg(dpr) {
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    var g = bgCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    var lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#170D0C');
    lg.addColorStop(0.55, '#110A0A');
    lg.addColorStop(1, '#0A0606');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);

    // 顶部一束顶光，像冰场灯打在冰面上
    var rg = g.createRadialGradient(W * 0.5, -H * 0.2, 8, W * 0.5, -H * 0.2, H * 1.15);
    rg.addColorStop(0, 'rgba(255,206,190,0.11)');
    rg.addColorStop(0.45, 'rgba(255,140,110,0.04)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);

    // 冰场标线：中线、中圈、两个争球圈
    g.strokeStyle = 'rgba(255,224,212,0.055)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, H * 0.5); g.lineTo(W, H * 0.5); g.stroke();
    var R = Math.min(W, H) * 0.2;
    g.beginPath(); g.arc(W * 0.5, H * 0.5, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(W * 0.5, H * 0.5, R * 0.12, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(W * 0.2, H * 0.5, R * 0.7, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(W * 0.8, H * 0.5, R * 0.7, 0, Math.PI * 2); g.stroke();

    // 挡板边线
    g.strokeStyle = 'rgba(255,224,212,0.09)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);

    // 上一层留下的浅刀痕，纯装饰
    g.strokeStyle = 'rgba(255,236,230,0.026)';
    for (var i = 0; i < 12; i++) {
      var x0 = Math.random() * W;
      var y0 = Math.random() * H;
      var r0 = 70 + Math.random() * Math.min(W, H) * 0.45;
      var a0 = Math.random() * Math.PI * 2;
      var sweep = 0.4 + Math.random() * 1.3;
      g.lineWidth = 0.8 + Math.random() * 1.1;
      g.beginPath();
      g.arc(x0, y0, r0, a0, a0 + sweep);
      g.stroke();
    }
  }

  /* ---------- 几何工具 ---------- */
  function toPx(p) { return { x: p.x * W, y: p.y * H }; }

  function resample(pts, step) {
    var cum = [0], i, total;
    for (i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    total = cum[cum.length - 1];
    if (!total) return { pts: pts.slice(), cum: [0], len: 0 };

    var n = Math.max(2, Math.round(total / step));
    var out = [], seg = 0;
    for (var k = 0; k <= n; k++) {
      var d = total * k / n;
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      var span = Math.max(1e-6, cum[seg + 1] - cum[seg]);
      var t = (d - cum[seg]) / span;
      out.push({
        x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t,
        y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t
      });
    }
    var cum2 = [0];
    for (i = 1; i < out.length; i++) cum2[i] = cum2[i - 1] + step;
    return { pts: out, cum: cum2, len: total };
  }

  // 按"已滑过的长度"取位置和朝向
  function at(pts, cum, d) {
    var i = 0;
    while (i < cum.length - 2 && cum[i + 1] < d) i++;
    var span = Math.max(1e-6, cum[i + 1] - cum[i]);
    var t = Math.min(1, Math.max(0, (d - cum[i]) / span));
    var a = pts[i], b = pts[i + 1];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      ang: Math.atan2(b.y - a.y, b.x - a.x)
    };
  }

  function angleDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /* ---------- 绘制 ---------- */
  function strokePts(pts, color, width, glow) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow) { ctx.shadowColor = 'rgba(255,150,120,0.6)'; ctx.shadowBlur = glow; }
    ctx.stroke();
    ctx.restore();
  }

  /* 人物剪影：按真实滑冰照片的姿态重画（支撑腿 + 后抬腿 + 前伸手臂），缩放旋转都不糊 */
  function shape(pts, ws) {
    // 沿一条中心线，按每段的宽度铺出一条封闭轮廓，比等宽线条更像"人"
    var L = [], R = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var len = Math.hypot(dx, dy) || 1;
      L.push([p[0] - dy / len * ws[i], p[1] + dx / len * ws[i]]);
      R.push([p[0] + dy / len * ws[i], p[1] - dx / len * ws[i]]);
    }
    ctx.beginPath();
    ctx.moveTo(L[0][0], L[0][1]);
    for (var k = 1; k < L.length; k++) ctx.lineTo(L[k][0], L[k][1]);
    for (var m = R.length - 1; m >= 0; m--) ctx.lineTo(R[m][0], R[m][1]);
    ctx.closePath();
    ctx.fill();
  }
  function dot(x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSkater(x, y, h, lean, dir) {
    var u = h / 300;
    ctx.save();
    ctx.translate(x, y);

    // 冰刀下的暖光
    var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.42);
    glow.addColorStop(0, 'rgba(255,160,130,0.20)');
    glow.addColorStop(1, 'rgba(255,120,90,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, 0, h * 0.42, h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(lean);
    ctx.scale(dir * u, u);
    ctx.translate(0, 10);            // 让支撑冰刀正好踩在路线上
    ctx.fillStyle = '#FBEEE8';
    ctx.strokeStyle = '#FBEEE8';
    ctx.shadowColor = 'rgba(255,120,90,0.5)';
    ctx.shadowBlur = 16;

    // 支撑腿
    shape([[-2, -154], [-10, -86], [-4, -26]], [20, 14, 10]);
    // 髋
    dot(-2, -156, 21, 13, 0);
    // 躯干：肩略前于髋 → 前倾
    shape([[-4, -160], [4, -198], [10, -230]], [17, 19, 23]);
    // 肩
    dot(8, -232, 25, 12, -0.08);
    // 颈 + 头
    shape([[14, -242], [16, -249]], [9, 8]);
    dot(20, -264, 16, 19, 0.06);
    // 前伸的手臂：肩 → 肘 → 腕（带一点下压）
    shape([[26, -230], [64, -236], [96, -228]], [13, 10, 7]);
    dot(100, -228, 6, 5, 0);
    // 体侧手臂
    shape([[-8, -228], [-20, -200], [-16, -172]], [12, 9, 7]);
    dot(-15, -170, 5.5, 5, 0);
    // 后抬的腿
    shape([[-2, -154], [-48, -134], [-86, -140]], [17, 12, 8]);
    // 两只靴子
    dot(-4, -20, 15, 10, 0);
    dot(-88, -136, 11, 8, -0.25);
    // 冰刀（支撑脚）
    ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-26, -10); ctx.lineTo(6, -10);
    ctx.quadraticCurveTo(15, -10, 17, -15); ctx.stroke();
    // 冰刀（抬起那只脚，朝后）
    ctx.beginPath(); ctx.moveTo(-100, -128); ctx.lineTo(-80, -132);
    ctx.quadraticCurveTo(-76, -132, -77, -126); ctx.stroke();

    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bgCanvas, 0, 0, W, H);

    // 历史刀痕
    for (var i = 0; i < traces.length; i++) {
      strokePts(traces[i].map(toPx), 'rgba(255,228,218,0.15)', 2);
    }

    // 正在画的线
    if (live.length > 1) strokePts(live, 'rgba(255,238,230,0.55)', 2.2, 10);

    var h = Math.max(120, Math.min(215, H * 0.42));

    if (skater) {
      // 还没滑到的部分：淡
      strokePts(skater.pts, 'rgba(255,228,218,0.13)', 2.4);
      // 已经滑过的部分：亮 + 发光
      var idx = 0;
      while (idx < skater.cum.length - 2 && skater.cum[idx + 1] < skater.d) idx++;
      var done = skater.pts.slice(0, idx + 1);
      if (skater.x != null) done.push({ x: skater.x, y: skater.y });
      strokePts(done, 'rgba(255,246,240,0.92)', 2.6, 18);

      if (skater.x != null) drawSkater(skater.x, skater.y, h, skater.lean, skater.dir);
    } else if (!live.length) {
      // 空场时让他站在冰上，别让这块看起来是空的
      drawSkater(W * 0.5, H * 0.7, h, 0, 1);
    }

    // 冰屑
    for (var s = 0; s < sparks.length; s++) {
      var sp = sparks[s];
      var a = 1 - sp.t / sp.life;
      ctx.fillStyle = 'rgba(255,242,236,' + (a * 0.85).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------- 动画 ---------- */
  var raf = 0, lastTs = 0;

  function tick(ts) {
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    if (skater && !skater.done) {
      skater.d += SPEED * dt;
      if (skater.d >= skater.len) { skater.d = skater.len; skater.done = true; }

      var p = at(skater.pts, skater.cum, skater.d);
      skater.x = p.x;
      skater.y = p.y;
      skater.dir = Math.cos(p.ang) >= 0 ? 1 : -1;

      // 用前后各 20px 的朝向差判断转弯，转弯越急倾角越大（像压刃）
      var a1 = at(skater.pts, skater.cum, Math.max(0, skater.d - 20)).ang;
      var a2 = at(skater.pts, skater.cum, Math.min(skater.len, skater.d + 20)).ang;
      var turn = angleDiff(a2, a1);
      var target = Math.max(-0.4, Math.min(0.4, turn * 0.85));
      skater.lean += (target - skater.lean) * Math.min(1, dt * 9);

      if (distEl) distEl.textContent = (skater.d / 100).toFixed(1) + ' m skated';

      if (skater.d < skater.len && Math.random() < 0.6) {
        sparks.push({
          x: p.x, y: p.y - 3,
          vx: -skater.dir * (30 + Math.random() * 90),
          vy: -(20 + Math.random() * 80),
          r: 0.8 + Math.random() * 1.7,
          life: 0.45 + Math.random() * 0.45,
          t: 0
        });
      }
    }

    for (var i = sparks.length - 1; i >= 0; i--) {
      var sp = sparks[i];
      sp.t += dt;
      if (sp.t >= sp.life) { sparks.splice(i, 1); continue; }
      sp.vy += 280 * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
    }

    draw();

    if ((skater && !skater.done) || sparks.length) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
      lastTs = 0;
    }
  }

  function run() {
    if (raf) return;
    lastTs = 0;
    raf = requestAnimationFrame(tick);
  }

  /* ---------- 出发 ---------- */
  function finalize(rawPx) {
    if (rawPx.length < 2) return;
    var r = resample(rawPx, STEP);
    if (r.len < MIN_LEN) return;

    if (skater) traces.push(skater.norm);
    if (traces.length > 8) traces.shift();

    var norm = r.pts.map(function (p) { return { x: p.x / W, y: p.y / H }; });

    skater = {
      norm: norm,
      pts: r.pts,
      cum: r.cum,
      len: r.len,
      d: 0,
      lean: 0,
      dir: 1,
      done: false,
      x: null,
      y: null
    };

    if (distEl) distEl.textContent = '0 m skated';

    if (reduce) {                      // 关掉动画就直接呈现终点
      var end = at(r.pts, r.cum, r.len);
      skater.d = r.len;
      skater.done = true;
      skater.x = end.x;
      skater.y = end.y;
      skater.dir = Math.cos(end.ang) >= 0 ? 1 : -1;
      if (distEl) distEl.textContent = (r.len / 100).toFixed(1) + ' m skated';
      draw();
      return;
    }
    run();
  }

  /* ---------- 指针事件 ---------- */
  function local(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    drawing = true;
    live = [local(e)];
    skater = null;
    sparks.length = 0;
    if (hintEl) hintEl.classList.add('is-gone');
    stage.classList.add('is-drawing');
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }
    draw();
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    e.preventDefault();
    var p = local(e);
    var q = live[live.length - 1];
    if (q && Math.hypot(p.x - q.x, p.y - q.y) < 2) return;   // 抖动的点不要
    live.push(p);
    draw();
  });

  function endStroke(e) {
    if (!drawing) return;
    drawing = false;
    stage.classList.remove('is-drawing');
    var raw = live;
    live = [];
    if (e && e.pointerId != null && canvas.releasePointerCapture) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    finalize(raw);
    draw();
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  /* ---------- 按钮 ---------- */
  function demoPath() {
    // 8 字形：滑冰最经典的一条线
    var pts = [];
    for (var i = 0; i <= 320; i++) {
      var t = (i / 320) * Math.PI * 2;
      pts.push({
        x: 0.5 + 0.33 * Math.cos(t),
        y: 0.5 + 0.34 * Math.sin(t) * Math.cos(t) * 1.6
      });
    }
    return pts;
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', function () {
      if (drawing) return;
      live = [];
      sparks.length = 0;
      if (hintEl) hintEl.classList.add('is-gone');
      finalize(demoPath().map(toPx));
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      live = [];
      traces = [];
      skater = null;
      sparks.length = 0;
      if (distEl) distEl.textContent = '0 m skated';
      if (hintEl) hintEl.classList.remove('is-gone');
      draw();
    });
  }

  /* ---------- 尺寸变化 ---------- */
  var rt = 0;
  function scheduleFit() {
    clearTimeout(rt);
    rt = setTimeout(fit, 120);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(scheduleFit).observe(stage);
  } else {
    window.addEventListener('resize', scheduleFit);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fit);
  } else {
    fit();
  }
})();
