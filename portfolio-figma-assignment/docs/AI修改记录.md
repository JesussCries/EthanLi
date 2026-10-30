# AI 修改记录 — Ethan Li Portfolio（对照 Figma 设计稿）

原始文件：`original/index-original.html`（Figma 导出的绝对定位 HTML）
对比视口：1440 × 5000 px（与设计稿 1440px 宽度一致）

---

## 第 1 轮：目录整理 + 结构拆分 + 素材本地化

**发现了什么问题**
- 原文件是 Figma 导出的"平铺片段"：全部样式内联、元素靠 left/top 绝对定位，区块顺序错乱（About 区块排在最后、top:1000px）。
- 截图 `00-before-original.png` 可见：Project 01 标题 "Figure Skating Journe" 被右侧图片截断、About 区块文字换行混乱、页脚元素与内容重叠。
- 图片引用的是外部占位服务 `https://placehold.co/...`，离线时无法加载。

**怎样向 AI 提要求**
> "把这个 Figma 导出的 HTML 整理成规范项目：按设计稿顺序排列区块（Hero → About → 三个 Project → Footer），CSS 拆分成独立 style.css，图片下载到本地 images/ 目录并修正引用路径。"

**修改后有什么变化**
- 建立 `index.html + css/style.css + images/` 的标准目录结构。
- 区块顺序修正为 Hero → About → Project 01/02/03 → Footer，用语义化标签（section/header/footer）重写。
- 创建本地占位图 `images/portrait.svg / about.svg / skating.svg`，页面可完全离线渲染。
- 截图 `01-after-round1-structure.png`：标题不再截断，各区块独立成段。

---

## 第 2 轮：修正布局塌陷 + 校准间距

**发现了什么问题**
- 对照截图发现 Project 02/03 的 650×560 大图区块**塌陷成一行文字**——原因是 CSS 选择器写成了 `.project-layout .big-img`，但 HTML 重构后该元素已不在 `.project-layout` 容器内，选择器匹配失败。
- Hero 大标题位置比设计稿偏高（设计稿中标题距页面顶部约 220px）。
- Hero 右侧卡片的头像与姓名间距、卡片内边距与设计稿（图 top:123px、姓名 top:395px）不符。
- About 兴趣标签（FIGURE SKATING / VIDEO GAMES / CREATIVE PROJECTS）间距过大。

**怎样向 AI 提要求**
> "对照设计稿逐项校准：① 修复 Project 02/03 大图不显示的问题；② Hero 标题下移到设计稿位置；③ 卡片内边距按设计稿数值（上 120px、下 90px）调整；④ 兴趣标签间距收紧到 44px。"

**修改后有什么变化**
- `.big-img` 选择器独立出来，两个项目的大图区块（米色圆角块）正常显示。
- Hero 标题、卡片内边距、兴趣标签间距均按设计稿数值校准。
- 截图 `02-after-round2-spacing.png`：三个项目的图片区域完整呈现。

---

## 第 3 轮：补齐装饰细节

**发现了什么问题**
- 设计稿 Hero 底部有一条 690px 宽的 1px 分隔线 + "PORTFOLIO / 2026" 小字标注，当前页面缺失。
- 设计稿的区块分隔线是 2px 亮红色（#F0060E），需确认保留。

**怎样向 AI 提要求**
> "按设计稿补上 Hero 底部的分隔线和 PORTFOLIO / 2026 标注，字号 10px、字距 1px、颜色 #786E63。"

**修改后有什么变化**
- 新增 `.hero-foot` 区块（分隔线 + 标注），与设计稿底部装饰一致。
- 截图 `03-final-1440.png` 为最终版本。

---

## 第 4 轮：替换真实照片

**发现了什么问题**
- 页面三处图片仍为 SVG 占位图，与设计稿"真实个人作品集"的定位不符。

**怎样向 AI 提要求**
> "这是我的真实照片：① 侧脸半身照（头像）② 灰色 Polo 衫照片（About）③ 花样滑冰比赛照（Project 01），请替换对应占位图并重新打包。"

**修改后有什么变化**
- 三张照片按用途重命名入库：`images/portrait.png`（Hero 圆形头像）、`images/about.png`（About 区块）、`images/skating.png`（Project 01 竖幅大图）。
- 均通过 `object-fit: cover` 自动裁切适配设计稿比例（265×258 圆形 / 552×437 / 586×880），无需手动裁图。
- 最终截图 `04-final-with-photos.png`。

---

## 最终对比说明（1440px 视口）

| 项目 | 状态 |
|------|------|
| 配色（#F6F4ED 背景 / #990F0E 强调 / #C9BFB0 分隔线） | 一致 |
| 字体层级（58px / 72px / 64px 标题，Inter 字重） | 一致 |
| 区块顺序与栅格布局 | 一致 |
| Hero 底部装饰线 + PORTFOLIO / 2026 标注 | 一致 |
| 红色区块分隔线（#F0060E, 2px） | 保留（导出稿中即为该颜色） |

**仍有差异及原因**
1. ~~图片内容不同~~ **已解决**：第 4 轮已替换为真实照片；Project 02/03 仍为设计稿中的米色占位区块（原稿即为占位）。
2. **导航吸顶（sticky）**：为增强可用性添加，设计稿中导航仅静态置于首屏 —— 属有意增强，非还原误差。
3. **区块垂直间距存在 ±20px 内误差**：设计稿导出坐标基于固定画布，网页版使用流式布局，段落间距由内容自然撑开 —— 待逐像素比对后可进一步校准（待排查）。
4. **About 照片自带蓝色圆角描边**：源自截图像素本身，如需去除需提供无边框原图 —— 待排查/待替换。
5. **Figma 参考图截图**：需从 Figma 网页端登录后手动导出，保存为 `screenshots/00-figma-reference.png` 一并提交。
