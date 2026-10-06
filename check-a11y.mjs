// check-a11y.mjs —— 这一页声称「放大到 200% 仍然好读、不靠颜色传信息」。
// 声称必须能被机器核对，否则它只是一句营销词。
//
// 跑法：node check-a11y.mjs [url]
//
// **已知边界（2026-10-06 实测）**：这套检查量的是布局、字号、对比度、语义、无 JS——
// **不量字形覆盖**。本机 chromium 默认没有中文字体，截图会全是豆腐块（□）而所有判据照样绿。
// 要截图给人看，先给 fontconfig 配 CJK 字体：
//   FONTCONFIG_FILE=<指向 noto-fonts-cjk 的 conf> node shot.mjs
// （同族：2026-09-24 typst 那次「编译成功但中文全 fallback」。）
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pw = require(process.env.AB_PLAYWRIGHT || "/home/kix/reclip/node_modules/playwright/index.js");
const { chromium } = pw;
import { execFileSync } from "node:child_process";

const URL = process.argv[2] || "https://grg41.github.io/";
const exe = process.env.AB_CHROMIUM || execFileSync("bash", ["-lc",
  "ls -1d /nix/store/*chromium-*/bin/chromium 2>/dev/null | head -1"]).toString().trim();

const results = [];
const check = (t, ok, d = "") => results.push({ t, ok, d });

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 320, height: 800 } });   // 窄屏 = 回流压力
await page.goto(URL, { waitUntil: "load" });

// ① 320px 宽不许横向溢出（WCAG 1.4.10 Reflow）
const overflow = await page.evaluate(() => ({
  sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
check("320px 宽无横向溢出", overflow.sw <= overflow.iw + 1, JSON.stringify(overflow));

// ② 基准字号 ≥ 20px
const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
check("基准字号 ≥ 20px", fs >= 20, `${fs}px`);

// ③ 正文对比度 ≥ 7:1（WCAG AAA）
const lum = (c) => { const s = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const colors = await page.evaluate(() => {
  const p = document.querySelector("p.lead") || document.body;
  const cs = getComputedStyle(p);
  const parse = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  return { fg: parse(cs.color), bg: parse(getComputedStyle(document.body).backgroundColor) };
});
const cr = ratio(colors.fg, colors.bg);
check("正文对比度 ≥ 7:1", cr >= 7, cr.toFixed(2) + ":1");

// ④ 第一个可聚焦元素是「跳到正文」
const first = await page.evaluate(() => {
  const el = document.querySelector("a, button, [tabindex]");
  return el ? (el.className || el.tagName) : null; });
check("首个可聚焦元素是跳转链接", String(first).includes("skip"), String(first));

// ⑤ 暗色方案下对比度仍然够（颜色不是唯一载体，且两套都要能读）
await page.emulateMedia({ colorScheme: "dark" });
const dark = await page.evaluate(() => {
  const parse = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  return { fg: parse(getComputedStyle(document.body).color),
           bg: parse(getComputedStyle(document.body).backgroundColor) }; });
const crd = ratio(dark.fg, dark.bg);
check("暗色方案对比度 ≥ 7:1", crd >= 7, crd.toFixed(2) + ":1");

// ⑥ 不依赖 JavaScript：禁用 JS 再取一次正文
const noJs = await browser.newContext({ javaScriptEnabled: false });
const p2 = await noJs.newPage();
const resp = await p2.goto(URL, { waitUntil: "load" });
const text = await p2.evaluate(() => document.body.innerText.length);
check("禁 JS 仍返回 200 且有正文", resp.status() === 200 && text > 1000, `HTTP ${resp.status()} / ${text} 字`);

await browser.close();
let bad = 0;
for (const r of results) { console.log(`${r.ok ? "✓" : "✗"} ${r.t}${r.ok ? "" : " —— " + r.d}`); if (!r.ok) bad++; }
console.log(bad === 0 ? `a11y: ${results.length}/${results.length} 通过（${URL}）` : `a11y: ${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
