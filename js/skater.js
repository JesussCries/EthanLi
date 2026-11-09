/* ============================================================
 * 人物剪影（公用）：按真实滑冰照片的姿态画一个人 ——
 * 支撑腿、后抬腿、前伸手臂、两只冰刀。
 *
 * 画线滑冰（skate.js）和躲障碍（obstacle.js）共用这一个函数，
 * 以后想改人物的样子，只改这里，两个地方一起变。
 *
 * 用法：SkaterPose.draw(ctx, x, y, h, lean, dir, opts)
 *   x, y   冰刀落点（人物脚底），人物从这里往上长
 *   h      身高像素（内部按 300 单位画，再整体缩放）
 *   lean   压刃倾角（弧度，向右为正）
 *   dir    +1 朝右、-1 朝左（镜像）
 *   opts   可选：{ color, glow }
 * ============================================================ */
(function () {
  'use strict';

  // 沿一条中心线，按每段的宽度铺出一条封闭轮廓，比等宽线条更像"人"
  function shape(ctx, pts, ws) {
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

  function dot(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(ctx, x, y, h, lean, dir, opts) {
    opts = opts || {};
    var color = opts.color || '#FBEEE8';
    var glowColor = opts.glow === undefined ? 'rgba(255,120,90,0.5)' : opts.glow;
    var u = h / 300;

    ctx.save();
    ctx.translate(x, y);

    // 冰刀下的暖光
    if (glowColor) {
      var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.42);
      glow.addColorStop(0, glowColor.replace(/[\d.]+\)$/, '0.20)'));
      glow.addColorStop(1, glowColor.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(0, 0, h * 0.42, h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.rotate(lean);
    ctx.scale(dir * u, u);
    ctx.translate(0, 10);            // 让支撑冰刀正好踩在脚下
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (glowColor) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = opts.blur === undefined ? 14 : opts.blur;
    }

    // 支撑腿
    shape(ctx, [[-2, -154], [-10, -86], [-4, -26]], [20, 14, 10]);
    // 髋
    dot(ctx, -2, -156, 21, 13, 0);
    // 躯干：肩略前于髋 → 前倾
    shape(ctx, [[-4, -160], [4, -198], [10, -230]], [17, 19, 23]);
    // 肩
    dot(ctx, 8, -232, 25, 12, -0.08);
    // 颈 + 头
    shape(ctx, [[14, -242], [16, -249]], [9, 8]);
    dot(ctx, 20, -264, 16, 19, 0.06);
    // 前伸的手臂：肩 → 肘 → 腕（带一点下压）
    shape(ctx, [[26, -230], [64, -236], [96, -228]], [13, 10, 7]);
    dot(ctx, 100, -228, 6, 5, 0);
    // 体侧手臂
    shape(ctx, [[-8, -228], [-20, -200], [-16, -172]], [12, 9, 7]);
    dot(ctx, -15, -170, 5.5, 5, 0);
    // 后抬的腿
    shape(ctx, [[-2, -154], [-48, -134], [-86, -140]], [17, 12, 8]);
    // 两只靴子
    dot(ctx, -4, -20, 15, 10, 0);
    dot(ctx, -88, -136, 11, 8, -0.25);
    // 冰刀（支撑脚）
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-26, -10); ctx.lineTo(6, -10);
    ctx.quadraticCurveTo(15, -10, 17, -15);
    ctx.stroke();
    // 冰刀（抬起那只脚，朝后）
    ctx.beginPath();
    ctx.moveTo(-100, -128); ctx.lineTo(-80, -132);
    ctx.quadraticCurveTo(-76, -132, -77, -126);
    ctx.stroke();

    ctx.restore();
  }

  window.SkaterPose = { draw: draw };
})();
