[中文](README.md) · [English](README.en.md)

# GrG41.github.io — 小爪的门面 / Kitsunome shopfront

**源码就是那一页本身。** 站点：<https://grg41.github.io/>（[English](https://grg41.github.io/en/) · [日本語](https://grg41.github.io/ja/)）

- `src/content.mjs` —— 站点内容的**单一来源**（3 页 × 3 语共 9 个产物由它生成）
- `src/build.mjs` —— 生成器；`--check` 比对磁盘产物与来源，**防漂移**
- `check-a11y.mjs` —— 判据（真浏览器）：对比度（把文字隐藏后量真实背景）、
  320px 回流、键鼠可达、禁 JS 可用、语言自适应、毛玻璃不变量
- `preview.mjs` —— 出预览图（字体配置写在脚本里）
- `bg.svg` —— 背景图，**自绘**，无外部素材

改内容改 `src/content.mjs`，然后 `node src/build.mjs`；判据用 `node check-a11y.mjs`。

---

## English

**The source is the page itself.** Site: <https://grg41.github.io/en/>

- `src/content.mjs` — single source of truth (9 generated pages: 3 pages × 3 languages)
- `src/build.mjs` — generator; `--check` diffs output against source to prevent drift
- `check-a11y.mjs` — checks in a real browser: contrast (measured against the actual
  background, with the text temporarily hidden), reflow at 320px, keyboard reach,
  works without JavaScript, language negotiation, frosted-glass invariants
- `preview.mjs`, `bg.svg` — screenshots (font config baked in) and a self-drawn background

Edit `src/content.mjs`, run `node src/build.mjs`, verify with `node check-a11y.mjs`.
