// 滚动相关动效：进度条 / 描边序号视差 / 区块渐入
(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 区块渐入 ---------- */
  var targets = document.querySelectorAll('.about, .project, footer');
  if ('IntersectionObserver' in window && !reduceMotion) {
    targets.forEach(function (el) { el.classList.add('reveal'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.08 });
    targets.forEach(function (el) { io.observe(el); });
    // 安全兜底：1.5s 后强制显示全部，避免异常情况下内容被隐藏
    setTimeout(function () {
      targets.forEach(function (el) { el.classList.add('visible'); });
    }, 1500);
  }

  /* ---------- 滚动回调统一走 rAF 节流 ---------- */
  var callbacks = [];
  var ticking = false;
  function onScrollFrame() {
    ticking = false;
    for (var i = 0; i < callbacks.length; i++) callbacks[i]();
  }
  function requestTick() {
    if (!ticking) { ticking = true; requestAnimationFrame(onScrollFrame); }
  }
  window.addEventListener('scroll', requestTick, { passive: true });
  window.addEventListener('resize', requestTick, { passive: true });

  /* ---------- 顶部进度条（transform 驱动，避免布局重排） ---------- */
  var bar = document.getElementById('progress');
  if (bar) {
    var doc = document.documentElement;
    callbacks.push(function () {
      var max = doc.scrollHeight - doc.clientHeight;
      var ratio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
      bar.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
    });
  }

  /* ---------- 描边序号滚动视差 ---------- */
  if (!reduceMotion) {
    var ghosts = document.querySelectorAll('.project .ghost');
    if (ghosts.length) {
      callbacks.push(function () {
        var vh = window.innerHeight;
        ghosts.forEach(function (g) {
          var rect = g.parentElement.getBoundingClientRect();
          var progress = (vh - rect.top) / (vh + rect.height); // 0 → 1
          if (progress > -0.2 && progress < 1.2) {
            g.style.transform = 'translateY(' + ((0.5 - progress) * 90).toFixed(1) + 'px)';
          }
        });
      });
    }
  }

  /* ---------- Help 页面：提议详情展开/收起 ---------- */
  (function offers() {
    var btns = document.querySelectorAll('.toggle-btn');
    if (!btns.length) return;

    function setOpen(card, btn, panel, open) {
      card.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.innerHTML = (open ? 'Hide details' : 'Show full plan') + ' <span class="chev" aria-hidden="true">&darr;</span>';
      panel.style.maxHeight = open ? panel.scrollHeight + 'px' : '0px';
    }

    btns.forEach(function (btn) {
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      var card = btn.closest('.offer');
      if (!panel || !card) return;
      panel.style.maxHeight = '0px';
      btn.addEventListener('click', function () {
        setOpen(card, btn, panel, !card.classList.contains('open'));
      });
    });

    // 窗口尺寸变化时重算已展开面板的高度
    window.addEventListener('resize', function () {
      document.querySelectorAll('.offer.open').forEach(function (card) {
        var panel = card.querySelector('.offer-details');
        if (panel) panel.style.maxHeight = panel.scrollHeight + 'px';
      });
    });
  })();

  requestTick(); // 首帧立即执行一次
})();
