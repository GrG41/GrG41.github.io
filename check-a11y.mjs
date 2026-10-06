// check-a11y.mjs —— 这一页声称的东西，全部用真浏览器核对。
//
// 跑法：node check-a11y.mjs [url]
//
// **已知边界**：本判据量布局、字号、对比度、语义、无 JS、以及**配色方案声明与高对比度三条通路**；
// **不量字形覆盖**——本机 chromium 默认没有中文字体，截图会全是豆腐块（□）而判据照样绿。
// 截图前先给 fontconfig 配 CJK 字体（同族：2026-09-24 typst「编译成功但中文全 fallback」）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AB_PLAYWRIGHT || "/home/kix/reclip/node_modules/playwright/index.js");
import { execFileSync } from "node:child_process";

const URL = process.argv[2] || "https://grg41.github.io/";
const exe = process.env.AB_CHROMIUM || execFileSync("bash", ["-lc",
  "ls -1d /nix/store/*chromium-*/bin/chromium 2>/dev/null | head -1"]).toString().trim();

const results = [];
const check = (t, ok, d = "") => results.push({ t, ok, d });
const lum = (c) => { const s = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const parseRgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
const colorsOf = (page) => page.evaluate(() => {
  const p = document.querySelector("p.lead") || document.body;
  return { fg: getComputedStyle(p).color, bg: getComputedStyle(document.body).backgroundColor }; });

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });

// ── 默认档（不模拟任何偏好）──────────────────────────────────────────────────
let page = await browser.newPage({ viewport: { width: 320, height: 800 }, locale: "zh-CN" });
await page.goto(URL, { waitUntil: "load" });

const overflow = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
check("320px 宽无横向溢出", overflow.sw <= overflow.iw + 1, JSON.stringify(overflow));

const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
check("基准字号 ≥ 20px", fs >= 20, `${fs}px`);

let c = await colorsOf(page);
const crDark = ratio(parseRgb(c.fg), parseRgb(c.bg));
check("默认档对比度 ≥ 7:1", crDark >= 7, crDark.toFixed(2) + ":1");
check("默认是暗色（背景暗、前景亮）", lum(parseRgb(c.bg)) < 0.2 && lum(parseRgb(c.fg)) > 0.5,
  `bg-lum=${lum(parseRgb(c.bg)).toFixed(3)} fg-lum=${lum(parseRgb(c.fg)).toFixed(3)}`);

// 声明：meta color-scheme + darkreader-lock + 计算样式里的 color-scheme
const decl = await page.evaluate(() => ({
  meta: document.querySelector('meta[name="color-scheme"]')?.content ?? null,
  lock: document.querySelector('meta[name="darkreader-lock"]') !== null,
  css: getComputedStyle(document.documentElement).colorScheme,
}));
check("声明 color-scheme（meta）", (decl.meta ?? "").includes("dark"), String(decl.meta));
check("声明 color-scheme（CSS）", (decl.css ?? "").includes("dark"), String(decl.css));
check("声明 darkreader-lock（阻止扩展二次暗色化）", decl.lock);

const first = await page.evaluate(() => {
  const el = document.querySelector("a, button, input, [tabindex]");
  return el ? (el.className || el.tagName) : null; });
check("首个可聚焦元素是跳转链接", String(first).includes("skip"), String(first));

// ── 高对比度：三条通路各验一次 ───────────────────────────────────────────────
await page.emulateMedia({ contrast: "more" });
c = await colorsOf(page);
const crMore = ratio(parseRgb(c.fg), parseRgb(c.bg));
check("prefers-contrast: more → 对比度 ≥ 15:1", crMore >= 15, crMore.toFixed(2) + ":1");
await page.emulateMedia({ contrast: "no-preference" });

const forced = await browser.newContext({ forcedColors: "active" });
const fp = await forced.newPage();
await fp.goto(URL, { waitUntil: "load" });
const fc = await fp.evaluate(() => ({
  scheme: getComputedStyle(document.documentElement).colorScheme,
  fg: getComputedStyle(document.body).color,
  bg: getComputedStyle(document.body).backgroundColor }));
check("forced-colors: active 下仍然可读（系统色接管）",
  fc.fg !== fc.bg && fc.fg.length > 0, JSON.stringify(fc));
await forced.close();

const btn = await page.$("input#hc");
if (btn === null) check("存在手动高对比度开关", false, "找不到 input#hc");
else {
  await btn.check();
  c = await colorsOf(page);
  const crHc = ratio(parseRgb(c.fg), parseRgb(c.bg));
  check("手动开关打开 → 纯黑白且对比度 ≥ 15:1",
    crHc >= 15 && lum(parseRgb(c.bg)) < 0.02, crHc.toFixed(2) + ":1");
  const ul = await page.evaluate(() => getComputedStyle(document.querySelector("main a")).textDecorationLine);
  check("高对比度下链接带下划线（不靠颜色区分）", ul.includes("underline"), ul);
}

// ── 多语言：默认中文、按浏览器语言自适应、手动切换与深链 ─────────────────────
const visible = (pg) => pg.evaluate(() => {
  const on = [...document.querySelectorAll("[data-lang-block]")]
    .filter((b) => getComputedStyle(b).display !== "none").map((b) => b.getAttribute("data-lang-block"));
  return { on, lang: document.documentElement.lang, chars: document.body.innerText.length };
});
let v = await visible(page);
check("中文环境：默认显示中文，且 html lang 正确", v.on.length === 1 && v.on[0] === "zh" && v.lang.startsWith("zh"),
  JSON.stringify(v));
check("页面上有三个语言块与三个切换项", await page.evaluate(() =>
  document.querySelectorAll("[data-lang-block]").length === 3 &&
  document.querySelectorAll(".lang a[data-lang]").length === 3));

for (const [loc, want] of [["en-US", "en"], ["ja-JP", "ja"], ["zh-CN", "zh"]]) {
  const c2 = await browser.newContext({ locale: loc });
  const p3 = await c2.newPage();
  await p3.goto(URL, { waitUntil: "load" });
  const r = await visible(p3);
  check(`浏览器语言 ${loc} → 自动显示 ${want}`, r.on.length === 1 && r.on[0] === want, JSON.stringify(r));
  await c2.close();
}

const p4 = await browser.newPage({ locale: "zh-CN" });
await p4.goto(URL + "#en", { waitUntil: "load" });
const r4 = await visible(p4);
check("深链 #en 覆盖自动识别（手动切换生效）", r4.on.length === 1 && r4.on[0] === "en" && r4.lang === "en",
  JSON.stringify(r4));
await p4.close();

// ── 界面文案不许混语言：三种语言下，顶栏开关必须是该语言的那一句 ───────────
// （第一版我用「汉字范围」判日文——错的：日文本来就用汉字。改成精确比对期望文案。）
for (const [loc, lang, expect] of [["en-US", "en", "High contrast"],
                                   ["ja-JP", "ja", "高コントラスト"],
                                   ["zh-CN", "zh", "高对比度"]]) {
  const c3 = await browser.newContext({ locale: loc });
  const p5 = await c3.newPage({ viewport: { width: 1280, height: 900 } });
  await p5.goto(URL, { waitUntil: "load" });
  const got = await p5.evaluate(() => document.querySelector("label[for=hc]").innerText.replace(/\s+/g, " ").trim());
  check(`${lang} 页面：开关文案是「${expect}」`, got === expect, JSON.stringify(got));
  // 那句「你的系统偏好亮色」的提示也必须跟着语言走，否则英文访客会读到一句中文。
  const hint = await p5.evaluate(() => document.querySelector("p.hint").innerText.replace(/\s+/g, " ").trim());
  const hintOk = lang === "en" ? (hint.includes("dark by default") && !/[\u3040-\u30ff]/.test(hint))
    : lang === "ja" ? hint.includes("既定で暗色")
    : hint.includes("默认暗色");
  check(`${lang} 页面：亮色提示也是该语言`, hintOk, JSON.stringify(hint));
  await c3.close();
}

// ── 次要文字也不能糊（美化最容易牺牲的就是它）────────────────────────────────
const mutedCr = await page.evaluate(() => {
  const el = document.querySelector("p.hint") || document.querySelector(".muted");
  const cs = getComputedStyle(el);
  const parse = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  return { fg: parse(cs.color), bg: parse(getComputedStyle(document.body).backgroundColor) }; });
check("次要文字对比度 ≥ 4.5:1", ratio(mutedCr.fg, mutedCr.bg) >= 4.5, ratio(mutedCr.fg, mutedCr.bg).toFixed(2) + ":1");

// ── 动画：减少动态偏好下不该有过渡 ───────────────────────────────────────────
await page.emulateMedia({ reducedMotion: "reduce" });
const td = await page.evaluate(() => getComputedStyle(document.querySelector(".lang a")).transitionDuration);
check("prefers-reduced-motion: reduce → 无过渡", td === "0s" || td === "0s, 0s", td);
await page.emulateMedia({ reducedMotion: "no-preference" });

check("有站点图标（favicon）", await page.evaluate(() => !!document.querySelector('link[rel="icon"]')));

// ── 亮色是**开关**，不是跟随系统；偏好亮色的人会看到一句提示 ─────────────────
await page.emulateMedia({ colorScheme: "light" });
const hint = await page.evaluate(() => getComputedStyle(document.querySelector("p.hint")).display);
check("系统偏好亮色时给出提示（而不是偷偷换色）", hint !== "none", `display=${hint}`);
check("系统偏好亮色时页面**仍然是暗的**（默认不变）",
  await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme).then((v) => v.includes("dark")));
await page.emulateMedia({ colorScheme: "no-preference" });
const lt = await page.$("input#lt");
if (lt === null) check("存在亮色开关", false, "找不到 input#lt");
else {
  await lt.check();
  c = await colorsOf(page);
  const crLt = ratio(parseRgb(c.fg), parseRgb(c.bg));
  check("亮色开关打开 → 对比度 ≥ 7:1", crLt >= 7, crLt.toFixed(2) + ":1");
  await lt.uncheck();
}

// ── 无 JavaScript ───────────────────────────────────────────────────────────
const noJs = await browser.newContext({ javaScriptEnabled: false });
const p2 = await noJs.newPage();
const resp = await p2.goto(URL, { waitUntil: "load" });
const text = await p2.evaluate(() => document.body.innerText.length);
const zhText = await p2.evaluate(() => document.querySelector('[data-lang-block="zh"]').innerText);
check("禁 JS 仍返回 200 且有正文（中文块可见）",
  resp.status() === 200 && zhText.includes("不让「看起来通过」发生") && text > 500,
  `HTTP ${resp.status()} / ${text} 字 / 关键句=${zhText.includes("不让「看起来通过」发生")}`);
const noJsVisible = await p2.evaluate(() => [...document.querySelectorAll("[data-lang-block]")]
  .filter((b) => getComputedStyle(b).display !== "none").map((b) => b.getAttribute("data-lang-block")));
check("禁 JS 时只显示中文（不靠脚本才有内容）",
  noJsVisible.length === 1 && noJsVisible[0] === "zh", JSON.stringify(noJsVisible));
await browser.close();

let bad = 0;
for (const r of results) { console.log(`${r.ok ? "✓" : "✗"} ${r.t}${r.ok ? "" : " —— " + r.d}`); if (!r.ok) bad++; }
console.log(bad === 0 ? `a11y: ${results.length}/${results.length} 通过（${URL}）` : `a11y: ${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
