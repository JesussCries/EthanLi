/* =========================================================================
   greet.js — 首屏「输入名字 → 用你的名字打招呼」
   -------------------------------------------------------------------------
   这条交互的四步：
     事件  访客在输入框里打字（input）、按回车或点「Say hi」（submit）
     数据  输入框里的文字 input.value（以及上次留在 localStorage 里的名字）
     规则  去掉首尾空格、多个空格压成一个、超过 18 个字截断；空字符串走默认文案
     输出  #greet-out 这段文字被改写，并闪一下高亮动画

   为什么单独放一个文件：这个功能是独立的，和页面其他动画互不依赖，
   单独成文件方便下次课指着这一个文件讲清楚「哪一行让它发生」。
   ========================================================================= */
(function () {
  'use strict';

  var form = document.getElementById('greet');
  var input = document.getElementById('greet-name');
  var out = document.getElementById('greet-out');

  // 页面上没有这套元素（比如 help.html 也引了脚本）时直接退出，不报错
  if (!form || !input || !out) return;

  var DEFAULT_TEXT = out.textContent;          // 记住初始文案，清空时还原用
  var STORAGE_KEY = 'ethan-guest-name';
  var MAX_LEN = 18;

  /* ---------- 规则：把用户输入变成「可以安全显示的名字」 ---------- */
  function cleanName(raw) {
    var name = String(raw).replace(/\s+/g, ' ').trim();  // 多个空格压成一个，去掉首尾空白
    if (name.length > MAX_LEN) name = name.slice(0, MAX_LEN) + '…';  // 太长会撑破卡片
    return name;
  }

  /* ---------- 输出：唯一改写页面的地方 ---------- */
  function render(name) {
    if (!name) {
      // 空输入 → 回到默认提示，而不是显示「Hi, （空）」
      out.textContent = DEFAULT_TEXT;
      out.classList.remove('is-hi');
      return;
    }

    // 为什么用 textContent 而不是 innerHTML：
    // 如果访客输入 <img src=x onerror=alert(1)>，innerHTML 会把它当代码执行，
    // textContent 只会把它当成一串普通文字显示出来 —— 更安全。
    out.textContent = 'Hi, ' + name + ' — welcome to my rink.';

    // 重新播放高亮动画：先移除 class，强制浏览器重排一次，再加回去。
    // 不加 void out.offsetWidth 的话，连续输入时浏览器会认为 class 没变过，动画不会重播。
    out.classList.remove('is-hi');
    void out.offsetWidth;
    out.classList.add('is-hi');
  }

  /* ---------- 数据：本地存一份，下次打开页面还记得你 ---------- */
  function save(name) {
    try {
      if (name) localStorage.setItem(STORAGE_KEY, name);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // 浏览器隐私模式 / file:// 下 localStorage 可能被禁用，存不了就算了，不影响交互
    }
  }

  /* ---------- 事件 1：每次输入都更新（input 比 keyup 更全，粘贴和输入法也能触发） ---------- */
  input.addEventListener('input', function () {
    var name = cleanName(input.value);
    render(name);
    save(name);
  });

  /* ---------- 事件 2：回车 / 点按钮 ---------- */
  form.addEventListener('submit', function (e) {
    // 为什么阻止默认行为：表单默认提交会刷新整个页面，刚打的字和动画全没了
    e.preventDefault();
    render(cleanName(input.value));
    input.blur();               // 收起输入状态，把焦点交回页面
  });

  /* ---------- 打开页面时：读回上次的名字 ---------- */
  var saved = '';
  try { saved = localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { saved = ''; }
  if (saved) {
    input.value = saved;
    render(cleanName(saved));   // 静默恢复，不播放动画（避免每次打开都闪）
    out.classList.remove('is-hi');
  }
})();
