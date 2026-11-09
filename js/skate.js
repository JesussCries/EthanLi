/* ============================================================
 * 冰场小游戏：访客画一条线，人物沿着这条线滑过去
 *
 * 事件：pointerdown 按下（开始画）→ pointermove 拖动（记录点）→ pointerup 松开（出发）
 * 数据：指针经过的坐标。存成 0–1 的相对值，所以窗口缩放后路线不会错位。
 * 规则：把点重新等距采样，再按"整条线滑完用多久"推进：起步蹬冰快、临近终点收刃慢，
 *       所以不会因为手快的地方点稀疏就跑得快。朝向由相邻两点算出，转弯越急压刃越深。
 * 输出：冰面刀痕 + 人物剪影的位置、朝向、倾斜角 + 冰屑 + 里程。
 * ============================================================ */
(function () {
  'use strict';

  var stage = document.getElementById('rink-stage');
  var canvas = document.getElementById('rink-canvas');
  if (!stage || !canvas) return;

  var ctx = canvas.getContext('2d');
  var hintEl = document.getElementById('rink-hint');
  var hintTxt = hintEl ? hintEl.querySelector('span') : null;
  var distEl = document.getElementById('rink-dist');
  var demoBtn = document.getElementById('rink-demo');
  var clearBtn = document.getElementById('rink-clear');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 0, H = 0;
  var bgCanvas = document.createElement('canvas');

  var live = [];          // 正在画的点（像素坐标）
  var traces = [];        // 画完的路线，留作冰面刻痕（相对坐标 + 缓存的像素坐标）
  var skater = null;      // 正在滑的状态
  var sparks = [];        // 冰屑
  var drawing = false;
  var rectCache = null;   // 画布位置缓存，pointermove 里不再反复读布局

  var STEP = 4;           // 重采样间距 px
  var MIN_LEN = 70;       // 太短的线当误触丢掉
  var MAX_TRACES = 8;     // 冰面最多留几条旧刻痕
  var MAX_SPARKS = 150;   // 冰屑上限，防止长时间滑动堆积
  var BASE_SPEED = 520;   // 用于推算时长：整条线按 520px/s 的节奏滑完
  var DUR_MIN = 0.75, DUR_MAX = 3.2;

  /* ---------- 尺寸 ---------- */
  function fit() {
    var r = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rectCache = canvas.getBoundingClientRect();

    // 尺寸变了：旧刻痕按相对坐标重新换算像素，正在滑的那条线保留进度
    for (var i = 0; i < traces.length; i++) traces[i].px = traces[i].norm.map(toPx);
    if (skater) {
      var uOld = skater.dur ? Math.min(1, skater.t / skater.dur) : 1;
      skater.geo = buildGeo(skater.norm);
      skater.dur = duration(skater.geo.len);
      skater.t = uOld * skater.dur;
      skater.d = skater.done ? skater.geo.len : glide(uOld) * skater.geo.len;
      place(skater);
    }

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

  function buildGeo(norm) {
    var r = resample(norm.map(toPx), STEP);
    return { pts: r.pts, cum: r.cum, len: r.len };
  }

  // 整条线滑多久：短的基本一眨眼，长的也留出 3 秒就能看完
  function duration(len) {
    return Math.max(DUR_MIN, Math.min(DUR_MAX, len / BASE_SPEED));
  }

  // 进度曲线：起步快（蹬冰），临近终点收得住（滑行收刃）
  function glide(u) {
    return 1 - Math.pow(1 - u, 1.6);
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

  /* 人物剪影：统一的画法放在 js/skater.js，这里只负责调用 */
  function drawSkater(x, y, h, lean, dir) {
    SkaterPose.draw(ctx, x, y, h, lean, dir);
  }

  // 路线顶到画布上沿时，人物按剩余空间收小，宁可小一点也不让头被切掉
  function fitHeight(y, hBase) {
    var room = (y - 6) / 0.95;                 // 人物从冰刀往上占 0.95h
    return Math.max(hBase * 0.45, Math.min(hBase, room));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bgCanvas, 0, 0, W, H);

    // 历史刀痕：越旧越淡，像一层层叠上去的冰面记忆
    for (var i = 0; i < traces.length; i++) {
      var fade = 0.045 + 0.085 * ((i + 1) / traces.length);
      strokePts(traces[i].px, 'rgba(255,228,218,' + fade.toFixed(3) + ')', 2);
    }

    // 正在画的线
    if (live.length > 1) strokePts(live, 'rgba(255,238,230,0.55)', 2.2, 10);

    var hBase = Math.max(120, Math.min(215, H * 0.42));

    // 起点做个记号，让人一眼看出这条线从哪儿开始
    var startPts = skater ? skater.geo.pts : null;
    if (startPts && startPts.length) {
      ctx.strokeStyle = 'rgba(255,238,230,0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(startPts[0].x, startPts[0].y, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (skater) {
      // 还没滑到的部分：淡
      strokePts(skater.geo.pts, 'rgba(255,228,218,0.13)', 2.4);
      // 已经滑过的部分：亮 + 发光
      var idx = 0;
      while (idx < skater.geo.cum.length - 2 && skater.geo.cum[idx + 1] < skater.d) idx++;
      var done = skater.geo.pts.slice(0, idx + 1);
      if (skater.x != null) done.push({ x: skater.x, y: skater.y });
      strokePts(done, 'rgba(255,246,240,0.92)', 2.6, 18);

      if (skater.x != null) {
        drawSkater(skater.x, skater.y, fitHeight(skater.y, hBase), skater.lean, skater.dir);
      }
    } else if (!live.length) {
      // 空场时让他站在冰上，别让这块看起来是空的
      drawSkater(W * 0.5, H * 0.7, hBase, 0, 1);
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

  /* ---------- 位置与姿态 ---------- */
  function place(sk) {
    var p = at(sk.geo.pts, sk.geo.cum, sk.d);
    sk.x = p.x;
    sk.y = p.y;
    sk.dir = Math.cos(p.ang) >= 0 ? 1 : -1;

    // 用前后各 20px 的朝向差判断转弯，转弯越急倾角越大（像压刃）
    var a1 = at(sk.geo.pts, sk.geo.cum, Math.max(0, sk.d - 20)).ang;
    var a2 = at(sk.geo.pts, sk.geo.cum, Math.min(sk.geo.len, sk.d + 20)).ang;
    var target = Math.max(-0.4, Math.min(0.4, angleDiff(a2, a1) * 0.85));
    sk.leanTarget = target + sk.dir * 0.06;   // 顺着滑行方向再压一点，看起来更"用力"
  }

  /* ---------- 动画 ---------- */
  var raf = 0, lastTs = 0, sparkAcc = 0, shownM = -1;

  function spawnSparks(n, x, y, dir, spread) {
    for (var i = 0; i < n && sparks.length < MAX_SPARKS; i++) {
      var a = (Math.random() - 0.5) * spread;
      var v = 40 + Math.random() * 130;
      sparks.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y - 3,
        vx: -dir * Math.cos(a) * v,
        vy: -Math.abs(Math.sin(a)) * v - 20,
        r: 0.8 + Math.random() * 1.7,
        life: 0.4 + Math.random() * 0.45,
        t: 0
      });
    }
  }

  function tick(ts) {
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    if (skater && !skater.done) {
      skater.t = Math.min(skater.dur, skater.t + dt);
      var u = skater.dur ? skater.t / skater.dur : 1;
      skater.d = glide(u) * skater.geo.len;
      place(skater);

      // 姿态平滑跟随，避免急弯时人物"甩"一下
      skater.lean += (skater.leanTarget - skater.lean) * Math.min(1, dt * 9);

      var m = Math.round(skater.d / 100);
      if (m !== shownM) {
        shownM = m;
        if (distEl) distEl.textContent = (skater.d / 100).toFixed(1) + ' m skated';
      }

      // 冰屑按"走过的距离"生成，快慢下密度都一致
      var v = (skater.dur ? glide(Math.min(1, u + 0.02)) - glide(u) : 0) * skater.geo.len / 0.02;
      sparkAcc += v * dt;
      if (v > 120 && sparkAcc > 16) {
        spawnSparks(1, skater.x, skater.y, skater.dir, 1.1);
        sparkAcc = 0;
      }
      if (sparkAcc > 64) sparkAcc = 0;

      if (u >= 1) {
        skater.done = true;
        skater.d = skater.geo.len;
        place(skater);
        skater.leanTarget = 0;
        spawnSparks(16, skater.x, skater.y, skater.dir, 2.2);   // 收刃那一下的雪雾
      }
    }

    for (var i = sparks.length - 1; i >= 0; i--) {
      var sp = sparks[i];
      sp.t += dt;
      if (sp.t >= sp.life) { sparks.splice(i, 1); continue; }
      sp.vy += 300 * dt;
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
  function pushTrace(norm) {
    traces.push({ norm: norm, px: norm.map(toPx) });
    if (traces.length > MAX_TRACES) traces.shift();
  }

  var hintTimer = 0;

  function finalize(rawPx) {
    if (rawPx.length < 2) return;
    var norm = rawPx.map(function (p) { return { x: p.x / W, y: p.y / H }; });
    var geo = buildGeo(norm);
    if (geo.len < MIN_LEN) {
      // 线太短，当误触：给一句话提示，过一会儿再恢复默认文案
      if (hintEl) hintEl.classList.remove('is-gone');
      if (hintTxt) hintTxt.textContent = 'Drag a longer line';
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () {
        if (hintTxt) hintTxt.textContent = 'Drag to draw';
      }, 1800);
      return;
    }

    skater = {
      norm: norm,
      geo: geo,
      d: 0,
      t: 0,
      dur: duration(geo.len),
      lean: 0,
      leanTarget: 0,
      dir: 1,
      done: false,
      x: null,
      y: null
    };
    place(skater);

    shownM = 0;
    if (distEl) distEl.textContent = '0.0 m skated';

    if (reduce) {                      // 关掉动画就直接呈现终点
      skater.d = geo.len;
      skater.done = true;
      place(skater);
      skater.lean = 0;
      if (distEl) distEl.textContent = (geo.len / 100).toFixed(1) + ' m skated';
      draw();
      return;
    }
    run();
  }

  /* ---------- 指针事件 ---------- */
  function local(e) {
    var r = rectCache || canvas.getBoundingClientRect();
    return {
      x: Math.max(1, Math.min(W - 1, e.clientX - r.left)),
      y: Math.max(1, Math.min(H - 1, e.clientY - r.top))
    };
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    rectCache = canvas.getBoundingClientRect();
    // 上一条滑完的线 → 变成冰面刻痕
    if (skater && skater.norm) pushTrace(skater.norm);
    drawing = true;
    live = [local(e)];
    skater = null;
    sparks.length = 0;
    sparkAcc = 0;
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
      if (skater && skater.norm) pushTrace(skater.norm);
      live = [];
      sparks.length = 0;
      sparkAcc = 0;
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
      sparkAcc = 0;
      shownM = -1;
      if (distEl) distEl.textContent = '0.0 m skated';
      if (hintEl) hintEl.classList.remove('is-gone');
      if (hintTxt) hintTxt.textContent = 'Drag to draw';
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
  window.addEventListener('orientationchange', scheduleFit);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fit);
  } else {
    fit();
  }
})();
