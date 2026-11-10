/* ============================================================
 * 冰场小游戏 02：SKATE RUN（3D）
 *
 * 事件：键盘 ← → / A D 控制左右，或者直接在冰面上拖拽；空格开始。
 * 数据：人物的横向位置 + 速度（vx）、锥子在世界里的 z 位置。
 * 规则：锥子从远处滑过来，速度随距离变快、间隔变短；
 *       人物靠"蹬冰加速"，松手会慢慢滑停 —— 所以提前量比猛推更重要。
 * 输出：撞到就结束，成绩是滑过的米数，最好成绩存在浏览器里。
 *
 * 渲染：three.js（本地 vendor/three.min.js，不依赖外网 CDN）
 *   - 低机位追尾镜头，雾化纵深，暖色顶灯在冰面上打出三团高光
 *   - 冰面/挡板贴图程序生成，靠滚动 UV 制造速度感
 *   - 人物用基本几何体拼骨架，程序化蹬冰循环；冰刀在冰面留下渐隐刀痕
 * ============================================================ */
(function () {
  'use strict';

  var stage = document.getElementById('game-stage');
  var canvas = document.getElementById('game-canvas');
  if (!stage || !canvas) return;

  /* ---------- 没有 WebGL / 3D 出问题时，退回 2D 版 ---------- */
  var dead = false;          // 一旦为 true，3D 的所有环节立即停手
  var fallbackDone = false;  // 保证只降级一次

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.defer = true;
    if (cb) s.onload = cb;
    document.body.appendChild(s);
  }

  /* 把发生的事情写到 console、标签页标题，并在画面上留一行可见提示，
     这样就算问题只出现在某台电脑上，截图也能直接看到原因 */
  function reportProblem(msg) {
    try { console.error('[rink3d] ' + msg); } catch (e2) {}
    try { document.title = 'Skate Run — 3D issue → 2D fallback'; } catch (e2) {}
    try {
      var note = document.createElement('div');
      note.textContent = '3D renderer problem (' + msg + ') — showing the 2D version instead.';
      note.style.cssText = 'position:absolute;top:10px;left:12px;z-index:3;font:600 11px/1.4 Inter,Arial,sans-serif;' +
        'color:#ffb491;background:rgba(10,5,5,0.72);padding:5px 10px;border-radius:6px;letter-spacing:.3px;';
      stage.appendChild(note);
    } catch (e2) {}
  }

  function fallback2D() {
    if (fallbackDone) return;
    fallbackDone = true;
    dead = true;
    // 旧 canvas 可能已经挂了 WebGL 上下文（一个 canvas 不能同时要 2d 和 webgl），
    // 所以先换一个干净的替身，再让 2D 版接管
    try {
      var fresh = canvas.cloneNode(false);
      if (canvas.parentNode) canvas.parentNode.replaceChild(fresh, canvas);
    } catch (e2) {}
    loadScript('js/skater.js', function () { loadScript('js/obstacle.js'); });
  }

  var hasGL = (function () {
    if (!window.THREE) return false;
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  })();
  if (!hasGL) { reportProblem('WebGL unavailable'); fallback2D(); return; }

  /* 下面这一大段 3D 初始化 + 主循环整体包进 try/catch：
     任何一台电脑上初始化抛错，都自动退回 2D 版，而不是留下一块坏画布 */
  try { main3D(); } catch (err) {
    reportProblem('init: ' + ((err && err.message) || err));
    fallback2D();
  }
  return;

  function main3D() {

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var overlay = document.getElementById('game-overlay');
  var elEyebrow = document.getElementById('game-eyebrow');
  var elTitle = document.getElementById('game-title');
  var elText = document.getElementById('game-text');
  var elStart = document.getElementById('game-start');
  var elDist = document.getElementById('game-dist');
  var elBest = document.getElementById('game-best');

  var best = 0;
  try { best = parseInt(localStorage.getItem('rinkRunBest') || '0', 10) || 0; } catch (e) { best = 0; }

  /* ============================================================
   *  基础
   * ============================================================ */
  var renderer, scene, camera;
  var W = 1, H = 1, aspect = 1;
  var DPR = Math.min(2, window.devicePixelRatio || 1);

  var ICE_HALF = 7.0;        // 冰面半宽（世界单位），随屏幕比例自适应
  var CAM = { z: 5.0, y: 1.82, fov: 64 };

  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(DPR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  /* 显卡驱动出问题导致 WebGL 上下文丢失时，不要留下黑屏/花屏，直接退 2D */
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    reportProblem('WebGL context lost');
    fallback2D();
  });

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0505);
  scene.fog = new THREE.Fog(0x0a0505, 20, 72);

  camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.1, 200);
  camera.position.set(0, CAM.y, CAM.z);

  /* ============================================================
   *  程序化贴图
   * ============================================================ */
  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function iceTexture() {
    var c = cv(512, 512), g = c.getContext('2d');
    g.fillStyle = '#241c1b';
    g.fillRect(0, 0, 512, 512);

    for (var i = 0; i < 70; i++) {
      var x = Math.random() * 512, y = Math.random() * 512, r = 40 + Math.random() * 130;
      var rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, Math.random() < 0.5 ? 'rgba(255,190,160,0.022)' : 'rgba(130,160,190,0.018)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    }

    for (var j = 0; j < 260; j++) {
      var x0 = Math.random() * 512, y0 = Math.random() * 512;
      var len = 30 + Math.random() * 190;
      var ang = (Math.random() < 0.72 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.55;
      g.strokeStyle = 'rgba(255,240,232,' + (0.018 + Math.random() * 0.055).toFixed(3) + ')';
      g.lineWidth = 0.4 + Math.random() * 1.15;
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(
        x0 + Math.cos(ang) * len * 0.5 + (Math.random() - 0.5) * 34,
        y0 + Math.sin(ang) * len * 0.5 + (Math.random() - 0.5) * 34,
        x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len
      );
      g.stroke();
    }

    // 每块贴图顶部一道淡横线：滚动起来就是速度参照
    g.strokeStyle = 'rgba(255,236,226,0.075)';
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(0, 3); g.lineTo(512, 3); g.stroke();

    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  function boardTexture() {
    var c = cv(256, 256), g = c.getContext('2d');
    var lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, '#2b1c19');
    lg.addColorStop(0.55, '#1d1312');
    lg.addColorStop(1, '#0d0808');
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 256);

    // 竖向支柱
    g.fillStyle = '#33201c';
    g.fillRect(0, 0, 12, 256);
    g.fillStyle = 'rgba(255,214,194,0.13)';
    g.fillRect(12, 0, 2, 256);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(14, 0, 5, 256);

    // 顶部一道暖光（灯打在挡板顶端）
    var tg = g.createLinearGradient(0, 0, 0, 40);
    tg.addColorStop(0, 'rgba(255,160,120,0.22)');
    tg.addColorStop(1, 'rgba(255,160,120,0)');
    g.fillStyle = tg;
    g.fillRect(0, 0, 256, 40);

    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  function radialTexture(inner, outer, size) {
    var s = size || 128;
    var c = cv(s, s), g = c.getContext('2d');
    var rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, inner);
    rg.addColorStop(0.45, outer);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // 环境贴图：一块暗底 + 顶部暖色灯带，给冰面和金属提供反射内容
  function envTexture() {
    var c = cv(512, 256), g = c.getContext('2d');
    var lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, '#2a1712');
    lg.addColorStop(0.45, '#150d0c');
    lg.addColorStop(1, '#070404');
    g.fillStyle = lg;
    g.fillRect(0, 0, 512, 256);

    // 顶部几盏灯
    for (var i = 0; i < 5; i++) {
      var x = 40 + i * 108, y = 24 + (i % 2) * 8;
      var rg = g.createRadialGradient(x, y, 0, x, y, 95);
      rg.addColorStop(0, 'rgba(255,225,205,0.55)');
      rg.addColorStop(0.3, 'rgba(255,175,135,0.26)');
      rg.addColorStop(1, 'rgba(255,140,100,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, 95, 0, 6.2832); g.fill();
    }
    var t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function iceRoughness() {
    var c = cv(512, 512), g = c.getContext('2d');
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 90; i++) {
      var x = Math.random() * 512, y = Math.random() * 512, r = 30 + Math.random() * 130;
      var v = Math.random() < 0.5 ? 100 : 190;
      var rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',0.5)');
      rg.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    }
    // 顺着滑行方向的长条：有的地方被磨得发亮
    for (var j = 0; j < 60; j++) {
      var y0 = Math.random() * 512;
      g.strokeStyle = 'rgba(' + (80 + Math.random() * 60) + ',0,0,0)';
      g.strokeStyle = Math.random() < 0.5 ? 'rgba(70,70,70,0.30)' : 'rgba(205,205,205,0.26)';
      g.lineWidth = 1 + Math.random() * 5;
      g.beginPath();
      g.moveTo(0, y0);
      g.bezierCurveTo(170, y0 + (Math.random() - 0.5) * 40, 340, y0 + (Math.random() - 0.5) * 40, 512, y0 + (Math.random() - 0.5) * 20);
      g.stroke();
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  var texIce = iceTexture();
  var texRough = iceRoughness();
  var texBoard = boardTexture();
  var texGlow = radialTexture('rgba(255,186,150,0.85)', 'rgba(255,120,86,0.20)', 128);
  var texDot = radialTexture('rgba(255,246,240,1)', 'rgba(255,230,220,0.35)', 64);
  var texShadow = radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0.30)', 128);
  scene.environment = envTexture();

  /* ============================================================
   *  冰场
   * ============================================================ */
  var rink = new THREE.Group();
  scene.add(rink);

  var ICE_LEN = 130;     // 冰面长度
  var TILE = 7;          // 贴图一格对应 7 个单位

  texIce.repeat.set(2, ICE_LEN / TILE);
  texRough.repeat.set(2, ICE_LEN / TILE);
  var iceMat = new THREE.MeshStandardMaterial({
    map: texIce,
    roughnessMap: texRough,
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.04,
    envMapIntensity: 0.62
  });
  var ice = new THREE.Mesh(new THREE.PlaneGeometry(ICE_HALF * 2, ICE_LEN), iceMat);
  ice.rotation.x = -Math.PI / 2;
  ice.position.set(0, 0, -ICE_LEN / 2 + 12);
  ice.receiveShadow = true;
  rink.add(ice);

  // 挡板
  var boardMat = new THREE.MeshStandardMaterial({
    map: texBoard, color: 0xffffff, roughness: 0.62, metalness: 0.06, side: THREE.DoubleSide
  });
  texBoard.repeat.set(ICE_LEN / 3, 1);
  var rails = [];
  var boards = [];
  var edges = [];
  [-1, 1].forEach(function (sgn) {
    var b = new THREE.Mesh(new THREE.PlaneGeometry(ICE_LEN, 1.02), boardMat);
    b.rotation.y = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
    b.position.set(sgn * ICE_HALF, 0.51, -ICE_LEN / 2 + 12);
    b.receiveShadow = true;
    rink.add(b);
    boards.push(b);

    // 顶部护条
    var rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.09, ICE_LEN),
      new THREE.MeshStandardMaterial({ color: 0x3a2420, roughness: 0.45, metalness: 0.25 })
    );
    rail.position.set(sgn * (ICE_HALF - 0.02), 1.06, -ICE_LEN / 2 + 12);
    rail.castShadow = false;
    rink.add(rail);
    rails.push(rail);

    // 护条内侧的一线暖光（呼应全站的珊瑚色）
    var edge = new THREE.Mesh(
      new THREE.PlaneGeometry(ICE_LEN, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xff7a63, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending })
    );
    edge.rotation.y = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
    edge.position.set(sgn * (ICE_HALF - 0.14), 0.99, -ICE_LEN / 2 + 12);
    rink.add(edge);
    edges.push(edge);
  });

  /* ---------- 冰场标线（循环流动） ---------- */
  var MARKS_SPAN = 54, MARKS_STEP = 18;
  var markGroup = new THREE.Group();
  rink.add(markGroup);
  var marks = [];

  var ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd9c8, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  var lineMat = new THREE.MeshBasicMaterial({
    color: 0xff8f78, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });

  function addMark(mesh, z) {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.011, z);
    markGroup.add(mesh);
    marks.push(mesh);
  }

  for (var mi = 0; mi < 3; mi++) {
    addMark(new THREE.Mesh(new THREE.RingGeometry(1.52, 1.70, 56), ringMat), 4 - mi * MARKS_STEP);
    addMark(new THREE.Mesh(new THREE.PlaneGeometry(ICE_HALF * 2, 0.10), lineMat), 4 - mi * MARKS_STEP - MARKS_STEP / 2);
  }

  /* ---------- 冰面上的光池（贴片，比真实高光可控得多） ---------- */
  var POOL_SPAN = 24;
  var pools = [];
  var poolMat = new THREE.MeshBasicMaterial({
    map: texGlow, color: 0xffb491, transparent: true, opacity: 0.20,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  for (var pi = 0; pi < 4; pi++) {
    var pool = new THREE.Mesh(new THREE.PlaneGeometry(11, 8), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(pi % 2 ? 2.0 : -2.0, 0.006, 2 - pi * POOL_SPAN);
    rink.add(pool);
    pools.push(pool);
  }

  /* ============================================================
   *  灯光
   * ============================================================ */
  scene.add(new THREE.HemisphereLight(0x4a2c24, 0x0f0808, 0.85));

  var key = new THREE.DirectionalLight(0xffd9c6, 3.1);
  key.position.set(6, 11, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.width = key.shadow.mapSize.height = 1024;
  key.shadow.camera.left = -16;
  key.shadow.camera.right = 16;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -14;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0012;
  key.shadow.radius = 3;
  key.shadow.camera.updateProjectionMatrix();   // 改完边界必须重建投影矩阵，否则阴影只在原点一小块
  scene.add(key);

  // 从身后打来的轮廓光：给人物肩背镶一道暖边
  var rim = new THREE.DirectionalLight(0xff8b64, 2.0);
  rim.position.set(-2.5, 3.4, -7.5);
  rim.target.position.set(0, 1.1, 1);
  scene.add(rim);
  scene.add(rim.target);

  // 远处的灯晕（只在雾里留几团暖光，不做真实聚光灯：
  // 聚光灯在光滑冰面上的 GGX 高光会炸成一个白团，不好控制）
  var spots = [];
  [-6, -24, -42].forEach(function (z, i) {
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texGlow, color: 0xffbb96, transparent: true, opacity: 0.30,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    halo.position.set(i % 2 ? 3.6 : -3.6, 8.6, z);
    halo.scale.set(4.0, 4.0, 1);
    scene.add(halo);
    spots.push(halo);
  });

  /* ============================================================
   *  人物骨架
   * ============================================================ */
  var SK = {};

  function buildSkater() {
    var root = new THREE.Group();          // 世界位置（x 横向，z 固定 0）
    var lean = new THREE.Group();          // 压刃倾斜 / 摔倒翻转
    var body = new THREE.Group();          // 上下起伏
    root.add(lean); lean.add(body);

    var skin = new THREE.MeshStandardMaterial({
      color: 0xf4e7df, roughness: 0.52, metalness: 0.03,
      emissive: 0x4a2018, emissiveIntensity: 0.55
    });
    var boot = new THREE.MeshStandardMaterial({ color: 0x2b1a16, roughness: 0.42, metalness: 0.3 });
    var steel = new THREE.MeshStandardMaterial({ color: 0xd9d3cf, roughness: 0.22, metalness: 0.9 });

    function capsule(r, len, mat) {
      var m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 14), mat);
      m.castShadow = true;
      return m;
    }

    // 躯干：一整根从髋到肩，不要腰间接缝（否则像拼起来的雪人）
    var torso = capsule(0.148, 0.54, skin);
    torso.position.set(0, 1.19, 0.035);
    torso.rotation.x = 0.14;
    body.add(torso);

    // 肩：两个小圆球，把肩膀从"一根柱子"里撑出来
    [-1, 1].forEach(function (sgn) {
      var sh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), skin);
      sh.position.set(sgn * 0.148, 1.375, 0.045);
      sh.castShadow = true;
      body.add(sh);
    });

    // 头
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.113, 20, 16), skin);
    head.position.set(0, 1.625, 0.085);
    head.castShadow = true;
    body.add(head);

    // 颈
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skin);
    neck.position.set(0, 1.525, 0.07);
    body.add(neck);

    // 毛线帽：一眼看出是"戴了装备的人"，而不是一个雪人
    var gear = new THREE.MeshStandardMaterial({ color: 0x2b1a16, roughness: 0.78, metalness: 0.02 });
    var cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.123, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), gear
    );
    cap.position.set(0, 1.628, 0.082);
    cap.castShadow = true;
    body.add(cap);

    var brim = new THREE.Mesh(new THREE.TorusGeometry(0.117, 0.019, 8, 26), gear);
    brim.rotation.x = Math.PI / 2;
    brim.position.set(0, 1.612, 0.082);
    body.add(brim);

    // 围巾：从颈后甩出去的一串小段，跑起来会飘
    var scarfMat = new THREE.MeshStandardMaterial({
      color: 0xff6a5c, roughness: 0.7, metalness: 0.02, emissive: 0x3a0f0a, emissiveIntensity: 0.8
    });
    var scarfRoot = new THREE.Group();
    scarfRoot.position.set(0, 1.45, 0.06);
    scarfRoot.rotation.y = -0.62;
    body.add(scarfRoot);
    var segs = [];
    var prev = scarfRoot;
    for (var sc = 0; sc < 5; sc++) {
      var sg = new THREE.Group();
      sg.position.z = 0.108;
      var piece = new THREE.Mesh(
        new THREE.BoxGeometry(0.108 - sc * 0.009, 0.016, 0.13), scarfMat
      );
      piece.position.z = 0.058;
      piece.castShadow = true;
      sg.add(piece);
      prev.add(sg);
      prev = sg;
      segs.push(sg);
    }
    SK.scarf = segs;

    // ---- 手臂 ----
    var arms = [];
    [-1, 1].forEach(function (sgn) {
      var sh = new THREE.Group();
      sh.position.set(sgn * 0.165, 1.36, 0.045);
      body.add(sh);

      var upper = capsule(0.055, 0.24, skin);
      upper.position.y = -0.15;
      sh.add(upper);

      var el = new THREE.Group();
      el.position.y = -0.29;
      sh.add(el);

      var fore = capsule(0.048, 0.22, skin);
      fore.position.y = -0.14;
      el.add(fore);

      var hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), skin);
      hand.position.y = -0.27;
      el.add(hand);

      arms.push({ sh: sh, el: el, sgn: sgn });
    });

    // ---- 腿 ----
    var legs = [];
    [-1, 1].forEach(function (sgn) {
      var hip = new THREE.Group();
      hip.position.set(sgn * 0.098, 0.9, 0);
      body.add(hip);

      var thigh = capsule(0.072, 0.28, skin);
      thigh.position.y = -0.2;
      hip.add(thigh);

      var knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);

      var shin = capsule(0.053, 0.28, skin);
      shin.position.y = -0.2;
      knee.add(shin);

      var ankle = new THREE.Group();
      ankle.position.y = -0.4;
      knee.add(ankle);

      var bootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.1, 0.26), boot);
      bootMesh.position.set(0, -0.04, 0.03);
      bootMesh.castShadow = true;
      ankle.add(bootMesh);

      var blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.026, 0.32), steel);
      blade.position.set(0, -0.098, 0.03);
      ankle.add(blade);

      legs.push({ hip: hip, knee: knee, ankle: ankle, sgn: sgn });
    });

    SK.root = root;
    SK.lean = lean;
    SK.body = body;
    SK.arms = arms;
    SK.legs = legs;
    scene.add(root);
  }
  buildSkater();

  /* ============================================================
   *  冰刀刀痕（一条会渐隐的带状几何）
   * ============================================================ */
  var TRAIL_MAX = 90;
  var trailPts = [];
  var trailGeo, trailMesh, trailPos, trailCol, trailIdxCount;

  function buildTrail() {
    trailGeo = new THREE.BufferGeometry();
    trailPos = new Float32Array(TRAIL_MAX * 2 * 3);
    trailCol = new Float32Array(TRAIL_MAX * 2 * 4);
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 4).setUsage(THREE.DynamicDrawUsage));

    var idx = [];
    for (var i = 0; i < TRAIL_MAX - 1; i++) {
      var a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    trailGeo.setIndex(idx);
    trailIdxCount = idx.length;
    trailGeo.setDrawRange(0, 0);

    var mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    trailMesh = new THREE.Mesh(trailGeo, mat);
    trailMesh.position.y = 0.012;
    trailMesh.frustumCulled = false;
    scene.add(trailMesh);
  }
  buildTrail();

  var trailTimer = 0;

  function pushTrail(x, z, force) {
    var last = trailPts[trailPts.length - 1];
    if (!force && last && Math.abs(last.x - x) < 0.04) return;
    trailPts.push({ x: x, z: z, age: 0 });
    if (trailPts.length > TRAIL_MAX) trailPts.shift();
  }

  function updateTrail(dt) {
    // 人物在世界里是不动的，是冰面往他流 —— 所以刀痕要自己往镜头这侧退
    for (var i = trailPts.length - 1; i >= 0; i--) {
      var pt = trailPts[i];
      pt.age += dt;
      pt.z += (speed || 0) * dt;
      if (pt.age > 2.6 || pt.z > 6) trailPts.splice(i, 1);
    }
    var n = trailPts.length;
    if (n < 2) { trailGeo.setDrawRange(0, 0); return; }

    var hw = 0.022;
    for (var k = 0; k < n; k++) {
      var p = trailPts[k];
      var prev = trailPts[Math.max(0, k - 1)];
      var next = trailPts[Math.min(n - 1, k + 1)];
      var dx = next.x - prev.x, dz = next.z - prev.z;
      var len = Math.hypot(dx, dz) || 1;
      var nx = -dz / len * hw, nz = dx / len * hw;
      var fade = Math.pow(1 - p.age / 2.6, 2.0) * 0.26;

      var o = k * 6;
      trailPos[o] = p.x + nx; trailPos[o + 1] = 0; trailPos[o + 2] = p.z + nz;
      trailPos[o + 3] = p.x - nx; trailPos[o + 4] = 0; trailPos[o + 5] = p.z - nz;

      var c = k * 8;
      trailCol[c] = 1.0; trailCol[c + 1] = 0.80; trailCol[c + 2] = 0.70; trailCol[c + 3] = fade;
      trailCol[c + 4] = 1.0; trailCol[c + 5] = 0.80; trailCol[c + 6] = 0.70; trailCol[c + 7] = fade;
    }
    trailGeo.setDrawRange(0, (n - 1) * 6);
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
  }

  /* ============================================================
   *  人物脚下的光池 + 接地阴影
   * ============================================================ */
  var lightPool = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 4.6),
    new THREE.MeshBasicMaterial({ map: texGlow, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  lightPool.rotation.x = -Math.PI / 2;
  lightPool.position.y = 0.008;
  scene.add(lightPool);

  var contact = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 1.15),
    new THREE.MeshBasicMaterial({ map: texShadow, transparent: true, opacity: 0.62, depthWrite: false })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.016;
  scene.add(contact);

  /* ============================================================
   *  锥子
   * ============================================================ */
  var coneGeo = new THREE.ConeGeometry(0.3, 0.88, 26, 1, true);
  var coneBaseGeo = new THREE.CylinderGeometry(0.335, 0.345, 0.07, 22);
  var coneBandGeo = new THREE.CylinderGeometry(0.155, 0.205, 0.13, 20, 1, true);
  var coneMat = new THREE.MeshStandardMaterial({
    color: 0xe4632a, roughness: 0.55, metalness: 0.05,
    side: THREE.DoubleSide, emissive: 0x3d1408, emissiveIntensity: 1.0
  });
  var coneBaseMat = new THREE.MeshStandardMaterial({ color: 0x8c3a15, roughness: 0.6, metalness: 0.05 });
  var coneBandMat = new THREE.MeshStandardMaterial({
    color: 0xfff2e6, roughness: 0.35, emissive: 0x663020, emissiveIntensity: 1.0
  });

  var cones = [];

  function makeCone() {
    var g = new THREE.Group();
    var body = new THREE.Mesh(coneGeo, coneMat);
    body.position.y = 0.44;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    var base = new THREE.Mesh(coneBaseGeo, coneBaseMat);
    base.position.y = 0.035;
    base.castShadow = true;
    g.add(base);

    var band = new THREE.Mesh(coneBandGeo, coneBandMat);
    band.position.y = 0.42;
    g.add(band);

    var halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texGlow, color: 0xff9a63, transparent: true, opacity: 0.30,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    halo.position.y = 0.5;
    halo.scale.set(1.1, 1.1, 1);
    g.add(halo);

    return g;
  }

  /* ---------- 障碍物多样化：矮栏 / 雪堆 / 会横移的旗锥 ---------- */

  // 矮栏：训练用跨栏，白栏 + 珊瑚色条，横着占半边冰面，只能从另一侧绕
  var hurdleBarGeo = new THREE.BoxGeometry(2.7, 0.15, 0.10);
  var hurdleStripeGeo = new THREE.BoxGeometry(2.7, 0.055, 0.11);
  var hurdlePostGeo = new THREE.BoxGeometry(0.10, 0.52, 0.10);
  var hurdleBarMat = new THREE.MeshStandardMaterial({ color: 0xf2e9e0, roughness: 0.55, metalness: 0.04 });
  var hurdleStripeMat = new THREE.MeshStandardMaterial({
    color: 0xff6a5c, roughness: 0.5, metalness: 0.04, emissive: 0x4a140e, emissiveIntensity: 1.0
  });
  var hurdlePostMat = new THREE.MeshStandardMaterial({ color: 0x3a2420, roughness: 0.5, metalness: 0.2 });

  function makeHurdle() {
    var g = new THREE.Group();
    var bar = new THREE.Mesh(hurdleBarGeo, hurdleBarMat);
    bar.position.y = 0.44;
    bar.castShadow = true;
    g.add(bar);
    var stripe = new THREE.Mesh(hurdleStripeGeo, hurdleStripeMat);
    stripe.position.y = 0.44;
    g.add(stripe);
    [-1, 1].forEach(function (s) {
      var post = new THREE.Mesh(hurdlePostGeo, hurdlePostMat);
      post.position.set(s * 1.22, 0.26, 0);
      post.castShadow = true;
      g.add(post);
    });
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texGlow, color: 0xffb491, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    halo.position.y = 0.5;
    halo.scale.set(3.0, 1.2, 1);
    g.add(halo);
    return g;
  }

  // 雪堆：扫冰时扫出来的小雪丘，又矮又圆，比锥子宽一点
  var snowGeo = new THREE.SphereGeometry(0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  var snowMat = new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.85, metalness: 0.0 });

  function makeSnow() {
    var g = new THREE.Group();
    var mound = new THREE.Mesh(snowGeo, snowMat);
    mound.scale.set(1.0, 0.72, 0.82);
    mound.position.y = 0.01;
    mound.castShadow = true;
    mound.receiveShadow = true;
    g.add(mound);
    // 顶部一小撮亮面，让它看起来像被灯照着
    var tip = new THREE.Mesh(snowGeo, snowMat);
    tip.scale.set(0.45, 0.5, 0.36);
    tip.position.set(0.16, 0.42, -0.08);
    g.add(tip);
    return g;
  }

  // 旗锥：锥子上插一面小旗，而且会左右横移
  var flagGeo = new THREE.PlaneGeometry(0.34, 0.20);
  var flagMat = new THREE.MeshBasicMaterial({
    color: 0xff6a5c, transparent: true, opacity: 0.95, side: THREE.DoubleSide
  });
  var flagPoleGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.42, 8);
  var flagPoleMat = new THREE.MeshStandardMaterial({ color: 0xd8cfc8, roughness: 0.4, metalness: 0.4 });

  function makeDrifter() {
    var g = makeCone();
    var pole = new THREE.Mesh(flagPoleGeo, flagPoleMat);
    pole.position.y = 1.02;
    g.add(pole);
    var flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.18, 1.14, 0);
    g.add(flag);
    return g;
  }

  function spawnObstacle(type, x, z, extra) {
    var g, halfW, halfD;
    if (type === 'hurdle') { g = makeHurdle(); halfW = 1.35; halfD = 0.42; }
    else if (type === 'snow') { g = makeSnow(); halfW = 0.52; halfD = 0.80; }
    else if (type === 'drift') { g = makeDrifter(); halfW = 0.30; halfD = 0.62; }
    else { g = makeCone(); halfW = 0.30; halfD = 0.62; }
    g.position.set(x, 0, z);
    scene.add(g);
    var item = { g: g, x: x, z: z, type: type, halfW: halfW, halfD: halfD };
    if (extra) for (var k in extra) item[k] = extra[k];
    cones.push(item);
    return item;
  }

  function spawnCone(x, z) { return spawnObstacle('cone', x, z); }

  /* ============================================================
   *  雪花 / 冰屑
   * ============================================================ */
  var SPRAY_MAX = 220;
  var sprayGeo = new THREE.BufferGeometry();
  var sprayPos = new Float32Array(SPRAY_MAX * 3);
  var sprayAlpha = new Float32Array(SPRAY_MAX);
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3).setUsage(THREE.DynamicDrawUsage));
  var sprayMat = new THREE.PointsMaterial({
    map: texDot, size: 0.065, transparent: true, opacity: 0.6,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  var spray = new THREE.Points(sprayGeo, sprayMat);
  spray.frustumCulled = false;
  scene.add(spray);

  var sprayState = [];

  function sprayAt(x, y, z, n, power) {
    if (reduce) return;
    for (var i = 0; i < n; i++) {
      if (sprayState.length >= SPRAY_MAX) sprayState.shift();
      sprayState.push({
        x: x + (Math.random() - 0.5) * 0.16,
        y: y,
        z: z + (Math.random() - 0.5) * 0.16,
        vx: (Math.random() - 0.5) * 2.6 * power,
        vy: (0.8 + Math.random() * 2.0) * power,
        vz: (Math.random() * 1.6) * power,
        life: 0.35 + Math.random() * 0.45,
        t: 0
      });
    }
  }

  function updateSpray(dt) {
    var n = 0;
    for (var i = sprayState.length - 1; i >= 0; i--) {
      var p = sprayState[i];
      p.t += dt;
      if (p.t >= p.life) { sprayState.splice(i, 1); continue; }
      p.vy -= 6.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.28; }
    }
    for (var k = 0; k < sprayState.length && k < SPRAY_MAX; k++) {
      var q = sprayState[k];
      sprayPos[n * 3] = q.x;
      sprayPos[n * 3 + 1] = q.y;
      sprayPos[n * 3 + 2] = q.z;
      n++;
    }
    sprayGeo.setDrawRange(0, n);
    sprayGeo.attributes.position.needsUpdate = true;
  }

  // 空气里的浮雪
  var FLAKES = 140;
  var flakeGeo = new THREE.BufferGeometry();
  var flakePos = new Float32Array(FLAKES * 3);
  for (var f = 0; f < FLAKES; f++) {
    flakePos[f * 3] = (Math.random() - 0.5) * 22;
    flakePos[f * 3 + 1] = Math.random() * 8;
    flakePos[f * 3 + 2] = 8 - Math.random() * 46;
  }
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3).setUsage(THREE.DynamicDrawUsage));
  var flakeMat = new THREE.PointsMaterial({
    map: texDot, size: 0.055, transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending
  });
  var flakes = new THREE.Points(flakeGeo, flakeMat);
  flakes.frustumCulled = false;
  scene.add(flakes);

  /* ============================================================
   *  游戏状态
   * ============================================================ */
  var state = 'idle';           // idle | run | fall | over
  var player = { x: 0, vx: 0, tx: null, lean: 0, tilt: 0 };
  var dist = 0, speed = 0, spawnIn = 0, elapsed = 0;
  var shake = 0, fallT = 0, idleBlend = 1;
  var sanityDone = false, sanityFrames = 0;
  var shownM = -1;
  var pointerDown = false;
  var keys = { left: false, right: false };
  var lastHit = 'cone';

  function maxV() { return Math.max(7.2, ICE_HALF * 1.25); }
  function accel() { return maxV() * 4.6; }
  function zLimit() { return ICE_HALF - 0.55; }

  function resetRun() {
    cones.forEach(function (c) { scene.remove(c.g); });
    cones.length = 0;
    trailPts.length = 0;
    sprayState.length = 0;
    dist = 0; spawnIn = 0.85; elapsed = 0;
    speed = 0;
    shake = 0; fallT = 0;
    shownM = -1;
    trailTimer = 0;
    player.x = 0; player.vx = 0; player.tx = null;
    player.lean = 0; player.tilt = 0;
    SK.root.position.set(0, 0, 0);
    SK.lean.rotation.set(0, 0, 0);
  }

  function start() {
    if (state === 'run') return;
    resetRun();
    state = 'run';
    overlay.hidden = true;
    stage.classList.add('is-running');
    elDist.textContent = '0 m';
    ensureLoop();
  }

  function crash(hitType) {
    state = 'fall';
    fallT = 0;
    lastHit = hitType || 'cone';
    shake = reduce ? 0 : 0.42;
    sprayAt(player.x, 0.35, 0.15, 34, 1.6);
  }

  // 结算文案按撞到的东西变化
  var HIT_LABEL = {
    cone: 'A pylon', gate: 'A pylon', triple: 'A pylon',
    hurdle: 'The hurdle', drift: 'A drifting pylon', snow: 'A snowbank'
  };
  function hitLabel() { return HIT_LABEL[lastHit] || 'A pylon'; }

  function showOver() {
    state = 'over';
    var m = Math.round(dist * 0.5);
    var wasBest = m > best;
    if (wasBest) {
      best = m;
      try { localStorage.setItem('rinkRunBest', String(best)); } catch (e) {}
    }
    elBest.textContent = best + ' m';
    elDist.textContent = m + ' m';
    elEyebrow.textContent = 'Rink 02 · Run over';
    elTitle.textContent = 'DOWN YOU GO';
    elText.innerHTML = wasBest && m > 0
      ? hitLabel() + ' caught you at <b>' + m + ' m</b> — that is your best run so far.'
      : hitLabel() + ' caught you at <b>' + m + ' m</b>. Best is ' + best + ' m.';
    elStart.textContent = 'Skate again';
    overlay.hidden = false;
    stage.classList.remove('is-running');
  }

  /* ============================================================
   *  更新
   * ============================================================ */
  function update(dt) {
    elapsed += dt;

    // 速度：随距离爬升，起步 0.9 秒内把速度提起来
    var base = Math.min(31, 12.5 + dist * 0.020);
    var ramp = Math.min(1, elapsed / 0.9);
    speed = base * (0.35 + 0.65 * ramp);
    dist += speed * dt;

    // 左右：有按键就蹬，松手滑停；拖拽则往手指方向吸
    var dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir) {
      player.tx = null;
      player.vx += dir * accel() * dt;
    } else if (player.tx != null) {
      player.vx += (player.tx - player.x) * 34 * dt;
      player.vx *= Math.pow(0.02, dt);
    } else {
      player.vx *= Math.pow(0.0012, dt);
    }
    var mv = maxV();
    player.vx = Math.max(-mv, Math.min(mv, player.vx));
    player.x += player.vx * dt;

    var lim = zLimit();
    if (player.x < -lim) { player.x = -lim; player.vx = Math.abs(player.vx) * 0.12; }
    if (player.x > lim) { player.x = lim; player.vx = -Math.abs(player.vx) * 0.12; }

    // 压刃：转向时整体倾斜
    var tiltTarget = Math.max(-1, Math.min(1, player.vx / mv)) * 0.26;
    player.tilt += (tiltTarget - player.tilt) * Math.min(1, dt * 8);

    // 锥子
    spawnIn -= dt;
    if (spawnIn <= 0) { spawn(); spawnIn = nextGap(); }
    for (var i = cones.length - 1; i >= 0; i--) {
      var c = cones[i];
      c.z += speed * dt;
      if (c.swayAmp) {
        c.phase += c.swaySpd * dt;
        c.x = c.baseX + Math.sin(c.phase) * c.swayAmp;
        c.g.position.x = c.x;
        c.g.rotation.y = -Math.cos(c.phase) * 0.3;
      }
      c.g.position.z = c.z;
      if (c.z > 2.4) { scene.remove(c.g); cones.splice(i, 1); continue; }
      c.g.visible = c.z > -46;
    }

    // 刀痕与冰屑
    trailTimer -= dt;
    if (trailTimer <= 0) { pushTrail(player.x, 0, true); trailTimer = 0.045; }
    var pushPhase = (elapsed * (1.5 + speed * 0.055)) % 1;
    if (pushPhase < 0.03 && Math.abs(player.vx) > 1.2) {
      sprayAt(player.x - Math.sign(player.vx) * 0.2, 0.05, 0.1, 3, 0.75);
    }
    if (elapsed % 0.16 < dt) sprayAt(player.x, 0.05, 0.05, 1, 0.35);

    updateTrail(dt);
    updateSpray(dt);

    shake *= Math.pow(0.02, dt);

    checkHit();

    var m = Math.round(dist * 0.5);
    if (m !== shownM) { shownM = m; elDist.textContent = m + ' m'; }
  }

  function nextGap() {
    var t = Math.max(0.40, 0.80 - dist * 0.0016);
    return t * (0.85 + Math.random() * 0.32);
  }

  /* ---------- 各类型障碍物的默认摆位 ---------- */
  function spawnGate(z) {
    var lim = zLimit();
    var gap = Math.max(2.0, ICE_HALF * 0.42);
    var gx = -lim + Math.random() * Math.max(0.1, (lim * 2 - gap));
    spawnCone(gx, z || -44);
    spawnCone(gx + gap, z || -44);
  }

  function spawnTriple(z) {
    var lim = zLimit();
    var n = 3, span = Math.min(2.2, lim * 0.75);
    var sx = -lim * 0.75 + Math.random() * (lim * 1.5 - span);
    var z0 = z || -44;
    for (var t = 0; t < n; t++) {
      spawnCone(sx + (t / (n - 1)) * span, z0 - t * 1.6);
    }
  }

  function spawnHurdle(z, x) {
    var lim = zLimit();
    var side = Math.random() < 0.5 ? -1 : 1;
    spawnObstacle('hurdle', x != null ? x : side * (lim - 1.35 - 0.45), z || -44);
  }

  function spawnDrift(z, x) {
    var lim = zLimit();
    var amp = Math.min(1.7, lim * 0.42);
    var bx = x != null ? x : (Math.random() * 2 - 1) * Math.max(0.1, lim - amp - 0.5);
    spawnObstacle('drift', bx, z || -44, {
      baseX: bx, swayAmp: amp, swaySpd: 1.8 + Math.random() * 1.4, phase: Math.random() * Math.PI * 2
    });
  }

  function spawnSnow(z, x) {
    var lim = zLimit();
    var side = Math.random() < 0.5 ? -1 : 1;
    spawnObstacle('snow', x != null ? x : side * (lim - 0.75), z || -44);
  }

  function spawnSingle() {
    var lim = zLimit();
    spawnCone(-lim + Math.random() * lim * 2, -44);
  }

  function spawn() {
    var meters = dist * 0.5;
    var r = Math.random();

    /* 按滑行距离逐步解锁：
       锥子/双锥门(一开始) → 斜排三连(75m) → 矮栏(130m) → 横移旗锥(190m) → 雪堆(250m) */

    if (r < 0.20 && ICE_HALF > 4.2) return spawnGate();
    if (r < 0.34 && meters > 75 && ICE_HALF > 4.2) return spawnTriple();
    if (r < 0.50 && meters > 130) return spawnHurdle();
    if (r < 0.64 && meters > 190) return spawnDrift();
    if (r < 0.74 && meters > 250) return spawnSnow();
    return spawnSingle();
  }

  function checkHit() {
    for (var i = 0; i < cones.length; i++) {
      var c = cones[i];
      if (Math.abs(c.z - 0.12) > (c.halfD || 0.62) + 0.20) continue;
      if (Math.abs(c.x - player.x) < c.halfW + 0.30) { crash(c.type); return; }
    }
  }

  /* ============================================================
   *  姿态
   * ============================================================ */
  function poseSkater(t) {
    var spd = speed || 0;
    var cadence = 1.25 + spd * 0.048;              // 每秒蹬冰次数
    var ph = (t * cadence) % 1;                    // 0..1：前半左腿蹬，后半右腿蹬
    var amp = Math.min(1, 0.35 + spd / 16);

    for (var i = 0; i < SK.legs.length; i++) {
      var leg = SK.legs[i];
      var p = i === 0 ? ph : (ph + 0.5) % 1;
      var swing = Math.sin(p * Math.PI * 2);
      var out = Math.max(0, swing);                // 向外蹬
      var back = Math.max(0, -swing);              // 收腿

      // 左腿（sgn=-1）向外是 -x，所以角取负
      var abduct = (0.08 + 0.40 * out) * amp;
      leg.hip.rotation.z = -leg.sgn * abduct;
      leg.hip.rotation.x = -0.06 - 0.26 * out * amp;
      leg.knee.rotation.x = 0.26 + 0.76 * back * amp;
      leg.ankle.rotation.x = -0.18 - 0.16 * back * amp;
    }

    // 躯干：上下起伏 + 左右微摆（蹬冰的节奏）
    var bob = Math.cos(ph * Math.PI * 4) * 0.026 * amp;
    SK.body.position.y = bob - 0.05;
    SK.body.position.x = Math.sin(ph * Math.PI * 2) * 0.030 * amp;
    SK.body.rotation.y = Math.sin(ph * Math.PI * 2) * 0.12 * amp;
    SK.lean.rotation.z = -player.tilt;
    SK.lean.rotation.x = -0.12 - Math.min(0.10, spd * 0.004);

    // 围巾：越跑越平，转向时往一侧甩
    for (var si = 0; si < SK.scarf.length; si++) {
      var sg = SK.scarf[si];
      sg.rotation.x = 0.10 + si * 0.03 + Math.sin(t * 8.2 - si * 0.8) * (0.05 + spd * 0.008);
      sg.rotation.y = -player.tilt * (0.5 + si * 0.25) + Math.sin(t * 5.6 - si * 0.6) * 0.06;
    }

    // 手臂：与腿反相摆动
    for (var a = 0; a < SK.arms.length; a++) {
      var arm = SK.arms[a];
      var ap = a === 0 ? (ph + 0.5) % 1 : ph;
      var sw = Math.sin(ap * Math.PI * 2);
      arm.sh.rotation.x = -0.34 + sw * 0.46 * amp;
      arm.sh.rotation.z = arm.sgn * (0.44 + 0.12 * Math.abs(sw));
      arm.el.rotation.x = -0.92 - 0.26 * Math.max(0, sw) * amp;
    }
  }

  function poseFallen(dt) {
    fallT += dt;
    var k = Math.min(1, fallT / 0.6);
    var e = 1 - Math.pow(1 - k, 3);
    var side = player.tilt >= 0 ? 1 : -1;
    // 侧倒：从背后看是横躺在地上，比面朝下摔更容易看懂
    SK.lean.rotation.z = -player.tilt * (1 - e) - side * e * 1.42;
    SK.lean.rotation.x = -e * 0.30;
    SK.root.position.y = e * 0.13;
    SK.body.position.y = 0;
    SK.body.position.x = 0;
    SK.body.rotation.y = 0;
    for (var i = 0; i < SK.legs.length; i++) {
      SK.legs[i].hip.rotation.z = -SK.legs[i].sgn * (0.22 + e * 0.30);
      SK.legs[i].hip.rotation.x = -0.1 - e * 0.25;
      SK.legs[i].knee.rotation.x = 0.35 + e * 0.55;
    }
    for (var a = 0; a < SK.arms.length; a++) {
      SK.arms[a].sh.rotation.x = -0.4 - e * 0.9;
      SK.arms[a].sh.rotation.z = SK.arms[a].sgn * (0.6 + e * 0.5);
      SK.arms[a].el.rotation.x = -0.5;
    }
  }

  /* ============================================================
   *  渲染
   * ============================================================ */
  function placeCamera(dt) {
    var follow = 0.62;
    var k = 1 - Math.exp(-dt * 4.2);
    camera.position.x += (player.x * follow - camera.position.x) * k;

    // 待机时机位往后退一点、视线偏左，把人物让到画面右侧给标题留位置
    var wantIdle = state === 'idle' ? 1 : 0;
    idleBlend += (wantIdle - idleBlend) * Math.min(1, dt * 2.4);
    var ib = idleBlend;

    var bobY = state === 'run' ? Math.sin(elapsed * 7.4) * 0.018 : 0;
    var now = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.001;
    camera.position.y = CAM.y + bobY - ib * 0.06;
    camera.position.z = CAM.z - ib * (0.15 + Math.sin(now * 0.55) * 0.22);

    var sx = shake > 0.001 ? (Math.random() - 0.5) * shake : 0;
    var sy = shake > 0.001 ? (Math.random() - 0.5) * shake : 0;

    var fallPull = state === 'fall' || state === 'over' ? Math.min(0.6, fallT * 0.7) : 0;
    camera.lookAt(player.x * 0.78 - ib * 1.15, 0.92 + ib * 0.12 - fallPull * 0.25, -6.5 - ib * 0.8);
    camera.rotateZ(-player.tilt * 0.10);
    if (sx || sy) {
      camera.position.x += sx * 0.6;
      camera.position.y += sy * 0.6;
    }

    // 速度越快视角越广，冲击感更强
    var fov = CAM.fov + Math.min(9, (speed - 12) * 0.42);
    if (Math.abs(camera.fov - fov) > 0.02) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 2.2);
      camera.updateProjectionMatrix();
    }
  }

  function render(dt) {
    dt = dt || 0;
    if (state === 'run') {
      texIce.offset.y += speed * dt / TILE;
      texRough.offset.y = texIce.offset.y;
      texBoard.offset.x -= speed * dt / 3;
      for (var mI = 0; mI < marks.length; mI++) {
        marks[mI].position.z += speed * dt;
        if (marks[mI].position.z > 14) marks[mI].position.z -= MARKS_SPAN;
      }
      for (var pI = 0; pI < pools.length; pI++) {
        pools[pI].position.z += speed * dt;
        if (pools[pI].position.z > 10) pools[pI].position.z -= POOL_SPAN * pools.length;
      }
    }

    // 空中浮雪缓慢下落，并跟着速度往后飘
    var fp = flakeGeo.attributes.position.array;
    for (var i = 0; i < FLAKES; i++) {
      fp[i * 3 + 1] -= dt * (0.22 + (i % 5) * 0.05);
      fp[i * 3 + 2] += (state === 'run' ? speed : 0) * dt * 0.02;
      if (fp[i * 3 + 1] < 0.05) fp[i * 3 + 1] = 7 + Math.random() * 2;
      if (fp[i * 3 + 2] > 9) fp[i * 3 + 2] = -44;
    }
    flakeGeo.attributes.position.needsUpdate = true;

    // 人物：位置 / 光池 / 接地阴影
    SK.root.position.x = player.x;
    SK.root.position.z = 0;
    lightPool.position.x += (player.x - lightPool.position.x) * Math.min(1, dt * 9);
    lightPool.position.z = 0.4;
    contact.position.x += (player.x - contact.position.x) * Math.min(1, dt * 12);
    contact.position.z = 0.05;

    placeCamera(dt);
    renderer.render(scene, camera);

    /* 画面自检：开画约一秒后把当前帧缩成小图采样一次，
       如果整幅画面几乎是一个纯色（方差≈0），说明这台机器的 WebGL
       在画但画得不对（驱动/着色器问题），自动退回 2D 版 */
    if (!sanityDone) {
      sanityFrames++;
      if (sanityFrames > 45) { sanityDone = true; sanityCheck(); }
    }
  }

  function sanityCheck() {
    if (dead) return;
    try {
      var sc = document.createElement('canvas');
      sc.width = 48; sc.height = 32;
      var sg = sc.getContext('2d');
      if (!sg) return;
      sg.drawImage(canvas, 0, 0, 48, 32);
      var d = sg.getImageData(0, 0, 48, 32).data;
      var n = 48 * 32, sum = 0, sum2 = 0;
      for (var i = 0; i < n; i++) {
        var lum = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
        sum += lum; sum2 += lum * lum;
      }
      var mean = sum / n;
      var std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      if (isNaN(std) || std < 3.5) {
        reportProblem('frame is uniform (std=' + std.toFixed(1) + ')');
        fallback2D();
      }
    } catch (e) { /* 采样失败不打扰游戏 */ }
  }

  /* ============================================================
   *  主循环
   * ============================================================ */
  var raf = 0, lastTs = 0;

  function ensureLoop() {
    if (!raf) { lastTs = 0; raf = requestAnimationFrame(loop); }
  }

  var lastIdleTs = 0;

  function loop(ts) {
    if (dead) return;   // 已退回 2D 版：3D 循环立即停手，别再碰旧画布
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    // 待机时降帧（画面里只是呼吸和雾），省电又不至于僵住
    if (state === 'idle') {
      if (ts - lastIdleTs < 70) { raf = requestAnimationFrame(loop); return; }
      lastIdleTs = ts;
    }

    if (state === 'run') {
      update(dt);
      poseSkater(elapsed);
    } else if (state === 'fall') {
      poseFallen(dt);
      updateTrail(dt);
      updateSpray(dt);
      if (fallT > 0.85) showOver();
    } else if (state === 'idle') {
      // 待机：轻微屈膝、手臂垂在体侧，慢慢呼吸
      var t = ts / 1000;
      SK.lean.rotation.z = Math.sin(t * 0.7) * 0.012;
      SK.lean.rotation.x = -0.06;
      SK.body.position.y = Math.sin(t * 1.1) * 0.012 - 0.02;
      SK.body.rotation.y = Math.sin(t * 0.5) * 0.05;
      for (var di = 0; di < SK.legs.length; di++) {
        SK.legs[di].hip.rotation.z = -SK.legs[di].sgn * 0.07;
        SK.legs[di].hip.rotation.x = -0.04;
        SK.legs[di].knee.rotation.x = 0.16 + Math.sin(t * 1.1) * 0.02;
        SK.legs[di].ankle.rotation.x = -0.12;
      }
      for (var da = 0; da < SK.arms.length; da++) {
        SK.arms[da].sh.rotation.x = -0.08;
        SK.arms[da].sh.rotation.z = SK.arms[da].sgn * 0.20;
        SK.arms[da].el.rotation.x = -0.45;
      }
    }
    // state === 'over'：什么都不动，保持摔倒的姿势

    render(dt);

    var busy = state === 'run' || state === 'fall' ||
               (state === 'idle' && onScreen) ||
               shake > 0.001 || trailPts.length > 1 || sprayState.length > 0;
    if (busy) {
      raf = requestAnimationFrame(loop);
    } else {
      raf = 0;
    }
  }

  /* ============================================================
   *  输入
   * ============================================================ */
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
    var t = (e.clientX - r.left) / Math.max(1, r.width);
    return Math.max(-zLimit(), Math.min(zLimit(), (t * 2 - 1) * ICE_HALF));
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (state !== 'run') return;
    e.preventDefault();
    pointerDown = true;
    player.tx = localX(e);
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!pointerDown || state !== 'run') return;
    e.preventDefault();
    player.tx = localX(e);
  });

  window.addEventListener('pointerup', function () { pointerDown = false; });

  if (elStart) elStart.addEventListener('click', start);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      keys.left = keys.right = false;
      if (state === 'run') {
        state = 'idle';
        resetRun();
        elEyebrow.textContent = 'Rink 02 · Paused';
        elTitle.textContent = 'PAUSED';
        elText.textContent = 'You left the rink for a moment. Start a new run when you are back.';
        elStart.textContent = 'Skate again';
        overlay.hidden = false;
        stage.classList.remove('is-running');
      }
    }
    lastTs = 0;
  });

  /* ============================================================
   *  尺寸
   * ============================================================ */
  function fit() {
    if (dead) return;
    var r = stage.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    aspect = W / H;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H, false);

    // 竖屏时收窄冰场，保证两侧挡板都在画面里
    var visHalf = CAM.z * Math.tan(CAM.fov * Math.PI / 360) * aspect;
    ICE_HALF = Math.max(3.0, Math.min(7.0, visHalf - 0.45));
    ice.scale.x = ICE_HALF / 7.0;

    rails.forEach(function (rail, i) {
      rail.position.x = (i === 0 ? -1 : 1) * (ICE_HALF - 0.02);
    });
    boards.forEach(function (b, i) {
      b.position.x = (i === 0 ? -1 : 1) * ICE_HALF;
    });
    edges.forEach(function (e, i) {
      e.position.x = (i === 0 ? -1 : 1) * (ICE_HALF - 0.14);
    });
    marks.forEach(function (m) {
      if (m.geometry && m.geometry.type === 'PlaneGeometry') m.scale.x = ICE_HALF / 7.0;
    });

    if (player.x) player.x = Math.max(-zLimit(), Math.min(zLimit(), player.x));
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    render();
  }

  var rt = 0;
  var onScreen = true;

  // 滚出视口就停渲染，别在看不见的地方空转
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      if (onScreen) ensureLoop();
    }, { threshold: 0.04 }).observe(stage);
  }

  function scheduleFit() {
    clearTimeout(rt);
    rt = setTimeout(fit, 120);
  }
  if (window.ResizeObserver) new ResizeObserver(scheduleFit).observe(stage);
  else window.addEventListener('resize', scheduleFit);
  window.addEventListener('orientationchange', scheduleFit);

  elBest.textContent = best + ' m';
  fit();
  ensureLoop();

  /* ---------- QA 钩子（只在 ?qa=1 时挂上） ---------- */
  if (/qa=1/.test(location.search)) {
    window.__rink = {
      start: start,
      move: function (x) { player.x = x; player.vx = 0; player.tx = null; },
      step: function (sec) {
        var t = 0;
        while (t < sec) { update(0.016); poseSkater(elapsed); t += 0.016; }
        render(0.016);
        return 'm=' + Math.round(dist * 0.5) + ' cones=' + cones.length + ' state=' + state + ' half=' + ICE_HALF.toFixed(1);
      },
      crash: crash,
      fall: function (sec) {
        var t = 0;
        while (t < sec) { poseFallen(0.016); updateTrail(0.016); updateSpray(0.016); t += 0.016; }
        if (fallT > 0.85) showOver();
        render(0.016);
        return 'state=' + state + ' fallT=' + fallT.toFixed(2);
      },
      over: function () { showOver(); render(0.016); return 'over'; },
      freeze: function () { state = 'idle'; idleBlend = 0; render(0.016); return 'frozen'; },
      obs: function (type, x, z) {
        if (type === 'hurdle') spawnHurdle(z, x);
        else if (type === 'drift') spawnDrift(z, x);
        else if (type === 'snow') spawnSnow(z, x);
        else if (type === 'gate') spawnGate(z);
        else if (type === 'triple') spawnTriple(z);
        else spawnCone(x != null ? x : 0, z != null ? z : -20);
        render(0.016);
        return 'cones=' + cones.length;
      },
      hide: function (what) {
        if (what === 'pools') pools.forEach(function (p) { p.visible = false; });
        if (what === 'spots') spots.forEach(function (p) { p.visible = false; });
        if (what === 'env') scene.environment = null;
        if (what === 'key') key.visible = false;
        if (what === 'pool') lightPool.visible = false;
        if (what === 'ice') ice.visible = false;
        if (what === 'key') key.visible = false;
        if (what === 'rim') rim.visible = false;
        if (what === 'spec') { iceMat.roughness = 1.0; iceMat.envMapIntensity = 0; iceMat.needsUpdate = true; }
        if (what === 'matte') { iceMat.metalness = 0; iceMat.envMapIntensity = 0; iceMat.needsUpdate = true; }
        render(0.016);
        return 'hid ' + what;
      },
      info: function () {
        return 'fov=' + camera.fov.toFixed(1) + ' camY=' + camera.position.y.toFixed(2) + ' kids=' + scene.children.length;
      }
    };
  }
  }  /* ---- end of main3D (整体包在 try/catch 里) ---- */
})();
