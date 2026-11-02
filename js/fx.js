// 视觉特效层：粒子背景 / 鼠标聚光灯 / 3D 倾斜 / 光晕跟随 / 磁吸导航 / 入场编排
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var root = document.documentElement;

  /* ================= 入场编排：给区块内元素打标记 ================= */
  var sections = document.querySelectorAll('.about, .project, footer');
  if (!reduce && 'IntersectionObserver' in window) {
    root.classList.add('js-anim');
    sections.forEach(function (sec) {
      var items = sec.querySelectorAll(
        '.eyebrow, h2, .meta, .intro, .bar, .interests, .facts > div, .project-img, .side-img, .about img, .footer-row > div'
      );
      items.forEach(function (el, i) {
        el.classList.add('fx-item');
        el.style.transitionDelay = Math.min(i * 0.09, 0.9).toFixed(2) + 's';
      });
      sec.querySelectorAll('.side-img, .about img, .project-img').forEach(function (el) {
        el.classList.add('img-reveal');
      });
      sec.querySelectorAll('.section-divider').forEach(function (el) {
        el.classList.add('grow-line');
      });
    });
  }

  /* ================= 统一 rAF 节流 ================= */
  var jobs = [];
  var ticking = false;
  function frame() {
    ticking = false;
    for (var i = 0; i < jobs.length; i++) jobs[i]();
  }
  function tick() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  window.addEventListener('scroll', tick, { passive: true });
  window.addEventListener('resize', tick, { passive: true });

  /* ================= 1. 粒子背景 ================= */
  (function particles() {
    var cvs = document.getElementById('particles');
    if (!cvs || reduce) return;
    // 自动化截图环境（webdriver）只渲染静态一帧，避免无限 rAF 循环干扰截图时序
    var staticFrame = navigator.webdriver === true;
    var ctx = cvs.getContext('2d');
    var W = 0, H = 0, dpr = 1, dots = [], running = true;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      cvs.width = W * dpr; cvs.height = H * dpr;
      cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function seed() {
      var count = Math.round(Math.min(70, Math.max(26, W / 22)));
      dots = [];
      for (var i = 0; i < count; i++) {
        dots.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 0.6 + Math.random() * 1.6,
          vy: -(0.10 + Math.random() * 0.35),
          vx: (Math.random() - 0.5) * 0.12,
          a: 0.10 + Math.random() * 0.30,
          p: Math.random() * Math.PI * 2
        });
      }
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        d.y += d.vy;
        d.x += d.vx + Math.sin(d.p += 0.006) * 0.14;
        if (d.y < -10) { d.y = H + 10; d.x = Math.random() * W; }
        if (d.x < -10) d.x = W + 10;
        if (d.x > W + 10) d.x = -10;
        var g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 5);
        g.addColorStop(0, 'rgba(255, 106, 92, ' + d.a + ')');
        g.addColorStop(1, 'rgba(255, 106, 92, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (running && !document.hidden && !staticFrame) requestAnimationFrame(draw);
    }
    resize(); seed();
    jobs.push(function () { /* 尺寸变化时重建 */ });
    window.addEventListener('resize', function () { resize(); seed(); }, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !running) { running = true; requestAnimationFrame(draw); }
      running = !document.hidden;
    });
    requestAnimationFrame(draw);
  })();

  /* ================= 2. 鼠标聚光灯 ================= */
  (function spotlight() {
    var el = document.getElementById('spotlight');
    if (!el || reduce || !canHover) return;
    window.addEventListener('mousemove', function (e) {
      el.style.setProperty('--mx', e.clientX + 'px');
      el.style.setProperty('--my', e.clientY + 'px');
      el.classList.add('on');
    }, { passive: true });
    document.addEventListener('mouseleave', function () { el.classList.remove('on'); });
  })();

  /* ================= 3. 图片 3D 倾斜 + 卡片光晕跟随 ================= */
  (function tilt() {
    if (reduce || !canHover) return;
    var imgs = document.querySelectorAll('.side-img, .about img');
    imgs.forEach(function (el) {
      el.classList.add('tilt');
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform =
          'perspective(1000px) rotateX(' + (-py * 6).toFixed(2) + 'deg) rotateY(' +
          (px * 7).toFixed(2) + 'deg) scale(1.02)';
      }, { passive: true });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    });

    // 首屏保持原样，只给项目占位块加光晕跟随
    var cards = document.querySelectorAll('.project-img');
    cards.forEach(function (el) {
      el.classList.add('glow-card');
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--cx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--cy', (e.clientY - r.top) + 'px');
      }, { passive: true });
    });
  })();

  /* ================= 4. 磁吸导航 + header 收缩 ================= */
  (function magnetic() {
    var links = document.querySelectorAll('nav a');
    if (!reduce && canHover) {
      links.forEach(function (a) {
        a.addEventListener('mousemove', function (e) {
          var r = a.getBoundingClientRect();
          var dx = (e.clientX - (r.left + r.width / 2)) / r.width;
          var dy = (e.clientY - (r.top + r.height / 2)) / r.height;
          a.style.transform = 'translate(' + (dx * 8).toFixed(1) + 'px,' + (dy * 5).toFixed(1) + 'px)';
        }, { passive: true });
        a.addEventListener('mouseleave', function () { a.style.transform = ''; });
      });
    }
    var header = document.querySelector('header');
    if (header) {
      jobs.push(function () {
        header.classList.toggle('compact', window.scrollY > 60);
      });
    }
  })();

  /* ================= 5. 描边序号随滚动发光 ================= */
  (function ghostGlow() {
    var ghosts = document.querySelectorAll('.project .ghost');
    if (!ghosts.length) return;
    jobs.push(function () {
      var vh = window.innerHeight;
      ghosts.forEach(function (g) {
        var r = g.getBoundingClientRect();
        var c = 1 - Math.min(1, Math.abs((r.top + r.height / 2) - vh / 2) / vh); // 0→1 越居中越大
        var a = (0.16 + 0.42 * Math.max(0, c)).toFixed(3);
        g.style.setProperty('-webkit-text-stroke-color', 'rgba(255, 106, 92, ' + a + ')');
      });
    });
  })();

  /* ================= 6. 开场加载幕 ================= */
  (function loader() {
    var el = document.getElementById('loader');
    if (!el || reduce) return;
    function hide() { el.classList.add('done'); }
    window.addEventListener('load', hide);
    setTimeout(hide, 1600); // 兜底：即使 load 事件延迟也能及时离场
  })();

  /* ================= 7. 自定义光标 ================= */
  (function cursor() {
    if (reduce || !canHover) return;
    var dot = document.getElementById('cur-dot');
    var ring = document.getElementById('cur-ring');
    if (!dot || !ring) return;
    var mx = -100, my = -100, rx = -100, ry = -100;
    document.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
      root.classList.add('cursor-on');
    }, { passive: true });
    (function loop() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = 'translate(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px)';
      requestAnimationFrame(loop);
    })();
    // 悬停可交互元素时光环放大
    document.addEventListener('mouseover', function (e) {
      var t = e.target;
      var interactive = t.closest && t.closest('a, nav a, .tilt, .project-img, .interests span, #rail a');
      ring.classList.toggle('grow', !!interactive);
    }, { passive: true });
    document.addEventListener('mouseleave', function () {
      root.classList.remove('cursor-on');
    });
  })();

  /* ================= 8. 右侧锚点导航轨 ================= */
  (function rail() {
    var rail = document.getElementById('rail');
    if (!rail) return;
    var labels = { home: 'Home', about: 'About', 'project-1': 'Project 01', 'project-2': 'Project 02', 'project-3': 'Project 03', contact: 'Contact' };
    var secs = document.querySelectorAll('header[id], section[id], footer[id]');
    var links = [];
    secs.forEach(function (sec) {
      var label = labels[sec.id] || sec.id;
      var a = document.createElement('a');
      a.href = '#' + sec.id;
      a.setAttribute('data-label', label);
      a.setAttribute('aria-label', label);
      rail.appendChild(a);
      links.push({ a: a, sec: sec });
    });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            links.forEach(function (l) { l.a.classList.toggle('active', l.sec === e.target); });
          }
        });
      }, { rootMargin: '-45% 0px -45% 0px' });
      links.forEach(function (l) { io.observe(l.sec); });
    }
  })();

  /* ================= 9. 首屏滚动视差 + 淡出 ================= */
  (function heroParallax() {
    if (reduce) return;
    var wrap = document.querySelector('.title-wrap');
    var copy = document.querySelector('.hero-copy');
    if (!wrap && !copy) return;
    jobs.push(function () {
      var sy = window.scrollY;
      if (sy > 1100) return;
      if (wrap) wrap.style.transform = 'translateY(' + (sy * 0.16).toFixed(1) + 'px)';
      if (copy) {
        copy.style.opacity = Math.max(0, 1 - sy / 620).toFixed(3);
        copy.style.transform = 'translateY(' + (sy * 0.08).toFixed(1) + 'px)';
      }
    });
  })();

  tick();
})();
