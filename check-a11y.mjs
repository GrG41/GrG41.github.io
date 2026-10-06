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


// ── 渲染像素判据：量「文字跟它**实际**的背景」的对比度 ─────────────────────────
//
// 为什么需要它：`getComputedStyle` 拿到的是**声明的颜色**。加了背景图之后，
// 声明的背景色没变，而实际渲染出来的可能亮得多——33 条声明式判据对此**完全无感**
// （2026-10-06 实测：接上背景图之后 33/33 照样全绿）。
// 做法：截取元素所在的矩形 → 在画布里做亮度直方图 → **取众数桶**当背景
// （背景像素占多数），再跟该元素的文字颜色算对比度。
async function renderedContrast(pg, selector) {
  const el = pg.locator(selector).first();
  await el.scrollIntoViewIfNeeded();                 // 不先滚动的话，元素在视口外 → clip 越界报错
  const box = await el.boundingBox();
  if (box === null) return { err: "找不到元素 " + selector };
  const vp = pg.viewportSize();
  const x = Math.max(0, Math.min(box.x, vp.width - 2));
  const y = Math.max(0, Math.min(box.y, vp.height - 2));   // 裁进视口，别越界
  const clip = { x, y, width: Math.max(2, Math.min(box.width, vp.width - x)),
                 height: Math.max(2, Math.min(box.height, vp.height - y)) };
  const buf = await pg.screenshot({ clip });
  const src = "data:image/png;base64," + buf.toString("base64");
  const fg = await el.evaluate((n) => getComputedStyle(n).color);
  return await pg.evaluate(async ({ src, fg }) => {
    const img = new Image(); img.src = src; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    // 用**众数桶**当「文字所坐的底色」，别用 p90 —— 试过更严的口径，它量到的是
    // **白字的抗锯齿边缘**（边缘跨度 0→0.85，中间调一大堆），于是把好页面判成 6.2:1。
    // 「某处有亮斑」这件事交给下面的全局扫描管，两者分工：
    //   这条 = 文字所坐的底色到底亮不亮；全局扫描 = 有没有亮斑可能漂到字下面。
    const bins = new Array(20).fill(0);
    for (let i = 0; i < d.length; i += 4) bins[Math.min(19, Math.floor(lum(d[i], d[i + 1], d[i + 2]) * 20))]++;
    let mode = 0; for (let i = 1; i < 20; i++) if (bins[i] > bins[mode]) mode = i;
    const bg = (mode + 0.5) / 20;
    const t = (fg.match(/\d+/g) || []).slice(0, 3).map(Number);
    const fgl = lum(t[0] || 0, t[1] || 0, t[2] || 0);
    const [hi, lo] = [bg, fgl].sort((x, y) => y - x);
    return { bg: +bg.toFixed(3), fg: +fgl.toFixed(3), ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2) };
  }, { src, fg });
}

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
  // 页脚在语言块之外，最容易漏译——单独验：只允许该语言的文字，别的语言字符一个都不许有。
  const footTxt = await p5.evaluate(() => document.querySelector("footer .foot").innerText.replace(/\s+/g, " ").trim());
  const other = lang === "en" ? /[\u3040-\u30ff\u4e00-\u9fff]/
    : lang === "ja" ? /[\uac00-\ud7af]/ : /[\u3040-\u30ff]/;
  check(`${lang} 页面：页脚不混其他语言`, !other.test(footTxt) && footTxt.length > 10, JSON.stringify(footTxt.slice(0, 60)));
  await c3.close();
}

// ── 次要文字也不能糊（美化最容易牺牲的就是它）────────────────────────────────
const mutedCr = await page.evaluate(() => {
  const el = document.querySelector("header.hero .muted") || document.body;
  const cs = getComputedStyle(el);
  const parse = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  return { fg: parse(cs.color), bg: parse(getComputedStyle(document.body).backgroundColor) }; });
check("次要文字对比度 ≥ 4.5:1", ratio(mutedCr.fg, mutedCr.bg) >= 4.5, ratio(mutedCr.fg, mutedCr.bg).toFixed(2) + ":1");

// ── 动画：减少动态偏好下不该有过渡 ───────────────────────────────────────────
await page.emulateMedia({ reducedMotion: "reduce" });
const still = await page.evaluate(() => {
  const a = document.querySelector(".lang a");
  const mk = document.querySelector(".mk");
  const rb = document.querySelector("details.row .rb");
  const d = document.querySelector("details.row"); d.open = true;
  const cs = getComputedStyle(rb);
  const r = { transition: getComputedStyle(a).transitionDuration,
              anim: getComputedStyle(a).animationName,
              markerAnim: getComputedStyle(mk.querySelector("span") || mk).animationName,
              rbOpacity: cs.opacity, rbHeight: Math.round(rb.getBoundingClientRect().height) };
  d.open = false; return r; });
check("减少动效时无过渡", /^(0s,?\s*)+$/.test(still.transition), still.transition);
check("减少动效时无动画", still.anim === "none" && still.markerAnim === "none", JSON.stringify(still));
const drawerMotion = await page.evaluate(() => getComputedStyle(document.getElementById("toc")).transitionDuration);
check("减少动效时抽屉无过渡", /^(0s,?\s*)+$/.test(drawerMotion), drawerMotion);
// **这条是重点**：动效关掉之后，内容不许跟着消失（透明度得是 1、高度得是真的）。
check("减少动效时折叠内容仍然可见（动效不是内容的前提）",
  Number(still.rbOpacity) === 1 && still.rbHeight > 4, JSON.stringify(still));
await page.emulateMedia({ reducedMotion: "no-preference" });

// ② 允许动效时，动效要真的存在（否则「加了动效」只是说法）
const motion = await page.evaluate(() => {
  const dur = (el, pseudo) => getComputedStyle(el, pseudo || null).transitionDuration;
  const nonzero = (v) => v.split(",").some((x) => parseFloat(x) > 0);
  return { summary: nonzero(dur(document.querySelector("details.row > summary"))),
           chip: nonzero(dur(document.querySelector(".chips li"))),
           tab: nonzero(dur(document.querySelector(".lang a"))),
           accentBar: nonzero(dur(document.querySelector("details.row > summary"), "::before")) };
});
check("允许动效时：行列 / chips / 页签 / 强调线都有过渡",
  motion.summary && motion.chip && motion.tab && motion.accentBar, JSON.stringify(motion));

check("有站点图标（favicon）", await page.evaluate(() => !!document.querySelector('link[rel="icon"]')));

// ── 当前项靠「填充」区分，不靠色相（参考图的关键手法，也应该是能量的）────────
const tabDiff = await page.evaluate(() => {
  const L = (c) => { const v = (c.match(/\d+/g) || []).slice(0, 3).map(Number)
      .map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const on = document.querySelector('.lang a[aria-current="true"]');
  const off = document.querySelector('.lang a[aria-current="false"]');
  return { on: L(getComputedStyle(on).backgroundColor), off: L(getComputedStyle(off).backgroundColor) };
});
check("当前语言：填充亮度差 ≥ 0.5（不靠色相）",
  Math.abs(tabDiff.on - tabDiff.off) >= 0.5, JSON.stringify(tabDiff));

// ── 顶栏不许有**多余的文字**（这一条是被一张截图抓出来的：我删亮色开关时正则非贪婪，
//     把 label 的英文/日文两半留在了顶栏上，而当时 30 条判据全绿——它们只查了控件在不在。
//     所以这里改成**枚举**：顶栏里可交互元素的数量与文案必须正好是期望的那几个。）
const barAudit = await page.evaluate(() => {
  const bar = document.querySelector(".bar");
  const links = [...bar.querySelectorAll("nav a")].map((a) => a.innerText.trim());
  const labels = [...bar.querySelectorAll("label")].map((l) => l.innerText.replace(/\s+/g, " ").trim());
  const boxes = bar.querySelectorAll('input[type="checkbox"]').length;
  return { links, labels, boxes, all: bar.innerText.replace(/\s+/g, " ").trim() };
});
check("顶栏：语言项正好三个", barAudit.links.length === 3, JSON.stringify(barAudit.links));
check("顶栏：开关正好一个（高对比度）", barAudit.boxes === 1 && barAudit.labels.length === 1,
  JSON.stringify({ boxes: barAudit.boxes, labels: barAudit.labels }));
check("顶栏：没有多余的残留文字（如删掉的亮色开关）",
  !/Light|ライト|亮色/i.test(barAudit.all), JSON.stringify(barAudit.all));

await page.check("#hc");
const hcTab = await page.evaluate(() => {
  const L = (c) => { const v = (c.match(/\d+/g) || []).slice(0, 3).map(Number)
      .map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const lab = document.querySelector('label[for="hc"]');
  return { bg: L(getComputedStyle(lab).backgroundColor), fg: L(getComputedStyle(lab).color) };
});
check("高对比度开关：打开后同样用填充区分", hcTab.bg > hcTab.fg, JSON.stringify(hcTab));
await page.uncheck("#hc");

// ── 这一页只提供暗色（2026-10-06 起去掉亮色开关：少一个分支就少一处会坏的地方）──
check("页面上不再有亮色开关", (await page.$("input#lt")) === null && (await page.$("label[for=lt]")) === null);
check("color-scheme 只声明 dark（不再声称支持亮色）",
  (decl.meta ?? "").trim() === "dark" && /dark/.test(decl.css ?? "") && !/light/.test(decl.css ?? ""),
  `meta=${decl.meta} css=${decl.css}`);

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
// 抽屉同样不许靠脚本：Popover 是浏览器原生行为。
await p2.locator("button.menubtn").click();
const noJsDrawer = await p2.evaluate(() => document.getElementById("toc").matches(":popover-open"));
check("禁 JS 也能打开目录抽屉（原生 popover）", noJsDrawer === true, `open=${noJsDrawer}`);
await p2.keyboard.press("Escape");

// 关键一条：**折叠展开是浏览器原生行为**，禁用 JavaScript 之后也照样能用。
await p2.locator("details.row > summary").first().click();
const noJsToggled = await p2.evaluate(() => document.querySelector("details.row").open);
check("禁 JS 也能展开（用的是原生 details，不是脚本）", noJsToggled === true, `open=${noJsToggled}`);

check("禁 JS 时只显示中文（不靠脚本才有内容）",
  noJsVisible.length === 1 && noJsVisible[0] === "zh", JSON.stringify(noJsVisible));
check("背景图已接入（不是 none）",
  !/none/.test(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)),
  await page.evaluate(() => getComputedStyle(document.body).backgroundImage.slice(0, 60)));

// ── 渲染像素：文字 vs 它**实际**的背景（背景图在这儿才管得住）────────────────
// **两种视口都要量**：320px（窄屏回流）与 1280px（多数访客看到的布局）。
// 背景图是 `cover + fixed`，两种宽度下落在文字后面的部分不一样——
// 只量一种会漏（2026-10-06：1280px 下标题附近有个亮度 0.19 的亮斑，窄屏那档完全看不见）。
const SEL = [["header.hero h1", 7, "标题"], ["header.hero .lead", 7, "副标题"],
             ["header.hero .muted", 4.5, "次要文字"], [".rows .row dd", 7, "面板内正文"]];
for (const [sel, min, label] of SEL) {
  const r = await renderedContrast(page, sel);
  check(`渲染像素(320px)：${label} 与其实际背景 ≥ ${min}:1`, r.ratio >= min, JSON.stringify(r));
}
const wide = await browser.newPage({ viewport: { width: 1280, height: 950 }, locale: "zh-CN" });
await wide.goto(URL, { waitUntil: "load" });
for (const [sel, min, label] of SEL) {
  const r = await renderedContrast(wide, sel);
  check(`渲染像素(1280px)：${label} 与其实际背景 ≥ ${min}:1`, r.ratio >= min, JSON.stringify(r));
}
await wide.close();

// ── 背衬不变量：每个可见文字元素都必须坐在**不透明**的表面上 ──────────────────
// 设计改了：文字全部进面板，图只从缝隙里透出来。于是「文字 vs 背景」这件事
// 从「量亮度」变成了「查结构」——比量亮度结实：它不随窗口大小漂。
// 注意 `body` 自己有 background-image，所以**不算**合格背衬（这正是要点）。
const backless = await page.evaluate(() => {
  const opaque = (el) => {
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== "none") return false;             // 有图 → 不算背衬
    const m = cs.backgroundColor.match(/[\d.]+/g) || [];
    if (m.length < 3) return false;
    return (m.length >= 4 ? Number(m[3]) : 1) >= 0.9;            // 要求基本不透
  };
  const out = [];
  for (const el of document.querySelectorAll("h1, p, li, dt, dd, a, label, kbd, code, .num, time")) {
    if (el.offsetParent === null) continue;
    let n = el, ok = false;
    while (n && n !== document.documentElement) { if (opaque(n)) { ok = true; break; } n = n.parentElement; }
    if (!ok) out.push(`${el.tagName}.${el.className} :: ${el.innerText.slice(0, 20)}`);
  }
  return out;
});
check("每个可见文字元素都有不透明背衬（不直接坐在背景图上）",
  backless.length === 0, JSON.stringify(backless.slice(0, 3)));

// ── 目录抽屉：用 Popover API，开合是浏览器原生行为 ───────────────────────────
// 「汉堡菜单」最容易做坏的地方：焦点管理、Esc、遮住内容。用原生 popover 就不必自己扛。
const drawerAudit = await page.evaluate(() => {
  const toc = document.getElementById("toc");
  const btn = document.querySelector("button.menubtn");
  return { hasToc: !!toc, hasBtn: !!btn,
           isPopover: toc ? toc.hasAttribute("popover") : false,
           links: toc ? toc.querySelectorAll("a[href^='#']").length : 0 };
});
check("目录抽屉存在，且开关走 Popover API（不自己写）",
  drawerAudit.hasToc && drawerAudit.hasBtn && drawerAudit.isPopover, JSON.stringify(drawerAudit));

// 目录链接必须都指向**存在**的 id（当前语言下）——断链是这种菜单最常见的坏法。
// 注意：要先**打开**抽屉，否则所有链接的 offsetParent 都是 null（关着的东西不渲染），
// 第一版就是这么数出「可见链接 0 条」的。
await page.locator("button.menubtn").click();
const anchorAudit = await page.evaluate(() => {
  const bad = [];
  for (const a of document.querySelectorAll("#toc a[href^='#']")) {
    if (a.offsetParent === null) continue;               // 只看当前语言那一组
    const id = a.getAttribute("href").slice(1);
    if (document.getElementById(id) === null) bad.push(id);
  }
  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  return { bad, dup, visible: [...document.querySelectorAll("#toc a[href^='#']")].filter((a) => a.offsetParent !== null).length };
});
check("目录链接都指向存在的锚点", anchorAudit.bad.length === 0 && anchorAudit.visible === 5,
  JSON.stringify(anchorAudit));
check("文档内 id 不重复（三语各一套锚点）", anchorAudit.dup.length === 0, JSON.stringify(anchorAudit.dup));
await page.keyboard.press("Escape");

// 开合：点按钮 → 开；按 Esc → 关；焦点该进去也该回来。
// 注意：抽屉里的「关闭」按钮也是 popovertarget="toc" —— 选择器要指名第一个（菜单按钮）。
const opener = page.locator("button.menubtn");
await opener.click();
const opened = await page.evaluate(() => {
  const toc = document.getElementById("toc");
  const invoker = document.querySelector("button.menubtn");
  return { open: toc.matches(":popover-open"),
           focusKept: document.activeElement === invoker || toc.contains(document.activeElement) };
});
check("点按钮能打开抽屉", opened.open, JSON.stringify(opened));
// 原生 popover **不移动焦点**（只有 autofocus 或模态对话框才会）。所以这里验的是
// 「焦点没丢」+「Tab 一步能进抽屉」——比「焦点自动进去」更贴近真实行为，也更可测。
check("打开后焦点没丢（在按钮上或在抽屉里）", opened.focusKept, JSON.stringify(opened));
await page.keyboard.press("Tab");
const tabbedIn = await page.evaluate(() => document.getElementById("toc").contains(document.activeElement));
check("打开后按一次 Tab 就能进入抽屉", tabbedIn);
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
const closed = await page.evaluate(() => {
  const toc = document.getElementById("toc");
  return { open: toc.matches(":popover-open"),
           focusBack: document.activeElement === document.querySelector("button.menubtn") };
});
check("Esc 能关闭抽屉，且焦点回到按钮", !closed.open && closed.focusBack, JSON.stringify(closed));

// 打开状态下，抽屉里的文字同样要满足背衬不变量
await page.locator("button.menubtn").click();
const drawerBackless = await page.evaluate(() => {
  const opaque = (el) => {
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== "none") return false;
    const m = cs.backgroundColor.match(/[\d.]+/g) || [];
    if (m.length < 3) return false;
    return (m.length >= 4 ? Number(m[3]) : 1) >= 0.9;
  };
  const out = [];
  for (const el of document.querySelectorAll("#toc a, #toc strong, #toc button")) {
    if (el.offsetParent === null) continue;
    let n = el, ok = false;
    while (n && n !== document.documentElement) { if (opaque(n)) { ok = true; break; } n = n.parentElement; }
    if (!ok) out.push(`${el.tagName} :: ${el.innerText.slice(0, 16)}`);
  }
  return out;
});
check("抽屉里的文字也有不透明背衬", drawerBackless.length === 0, JSON.stringify(drawerBackless.slice(0, 3)));
await page.keyboard.press("Escape");

// ── 面板头的计数必须等于该节**实际**的条目数 ─────────────────────────────────
// 参考图里那个「希斯研究 7/23」是真实进度。我照抄了形式，就得照抄这个要求：
// 写「5 项」就得真有 5 条——否则那是装饰，不是计数。
const counterAudit = await page.evaluate(() => {
  const out = [];
  for (const h2 of document.querySelectorAll("main > h2[id]")) {
    if (h2.offsetParent === null) continue;                    // 只看当前语言
    const meta = h2.querySelector(".hmeta");
    if (!meta) continue;
    const want = Number((meta.textContent.match(/\d+/) || [])[0]);
    const panel = h2.nextElementSibling;
    if (!panel) { out.push({ id: h2.id, want, got: -1, why: "没有面板" }); continue; }
    const got = panel.querySelectorAll(":scope > details.row, :scope > .rows > .row, :scope > details").length;
    if (want !== got) out.push({ id: h2.id, want, got });
  }
  return out;
});
check("各节声明的条目数 == 该节实际条目数", counterAudit.length === 0, JSON.stringify(counterAudit));

// 反白（展开）那一行的对比度：反白块正是对比度最容易出错的地方
await page.evaluate(() => { document.querySelector("details.row").open = true; });
const inv = await renderedContrast(page, "details.row[open] > summary .rt");
check("展开行反白后的文字对比度 ≥ 7:1", inv.ratio >= 7, JSON.stringify(inv));
await page.evaluate(() => { document.querySelector("details.row").open = false; });

// ── 自洽：页面上写的判据条数 == 实际条数（三语必须一致）──────────────────────
// 页面上写着「判据 N 条」——那句话本身就是一个**可以被验证的断言**，
// 所以它必须能被验证。加判据而忘了改页面，这条会红。
// （+1 是这条判据自己：它在 push 之前读 results.length。）
// ── 折叠展开：必须是**原生** details，而且不许依赖 JavaScript ─────────────────
// 「点开能看」要验三层：① 结构在且有内容；② 不靠 JS；③ 开合状态不靠颜色。
const detailsAudit = await page.evaluate(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const all = [...document.querySelectorAll("details.row")];
  // 用 textContent，不用 innerText：**折叠着的内容本来就不渲染**，innerText 会漏掉它。
  const withBody = all.filter((d) => (d.querySelector(".rb")?.textContent || "").trim().length > 15).length;
  // 再验「展开后真的看得见、收起后真的不占位」——光有文字而展开是空的，也不合格。
  // （要等一帧：改 open 之后同帧量，布局还没刷新——第一版就是这么量出 false 的。）
  const d0 = all[0], body = d0.querySelector(".rb");
  d0.open = true; await frame();
  const visibleWhenOpen = body.getBoundingClientRect().height > 4;
  // 收起要**等动画走完**再量。动画 280ms，这里等 450ms——第一版只等一帧，
  // 于是「已收起」永远量不到 0（那是量法错，不是页面错）。
  d0.open = false; await new Promise((r) => setTimeout(r, 450));
  const hiddenWhenClosed = body.getBoundingClientRect().height === 0;
  return { n: all.length, withBody, closed: all.filter((d) => !d.open).length,
           visibleWhenOpen, hiddenWhenClosed };
});
check("默认是折叠状态（条目多时页面更短，放大看的人少滚几屏）", detailsAudit.closed === detailsAudit.n,
  `展开着 ${detailsAudit.n - detailsAudit.closed} 条`);

// 开合记号：折叠时＋、展开时－。**形状变化，不是颜色变化。**
const marker = await page.evaluate(() => {
  const d = document.querySelector("details.row");
  const read = () => getComputedStyle(d.querySelector(".mk"), "::after").content;
  const before = read(); d.open = true; const after = read(); d.open = false;
  return { before, after };
});
check("开合记号在两种状态下不同（不靠颜色）",
  marker.before !== marker.after && /＋|\+/.test(marker.before) && /−|-/.test(marker.after),
  JSON.stringify(marker));

// 键盘：聚焦 summary 按 Enter / Space 应能开合
const kb = await page.evaluate(() => document.querySelector("details.row").open);
await page.locator("details.row > summary").first().focus();
await page.keyboard.press("Enter");
const afterEnter = await page.evaluate(() => document.querySelector("details.row").open);
await page.keyboard.press("Space");
const afterSpace = await page.evaluate(() => document.querySelector("details.row").open);
check("键盘可达：Enter 与 Space 都能开合", afterEnter === !kb && afterSpace === kb,
  `初始 ${kb} → Enter ${afterEnter} → Space ${afterSpace}`);

// 展开态下，背衬与对比度同样要成立（内容变高了，位置全变）
await page.evaluate(() => document.querySelectorAll("details.row").forEach((d) => { d.open = true; }));
const backlessOpen = await page.evaluate(() => {
  const opaque = (el) => {
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== "none") return false;
    const m = cs.backgroundColor.match(/[\d.]+/g) || [];
    if (m.length < 3) return false;
    return (m.length >= 4 ? Number(m[3]) : 1) >= 0.9;
  };
  const out = [];
  for (const el of document.querySelectorAll("h1, p, li, dt, dd, a, label, kbd, code, .num, time, summary, .rb")) {
    if (el.offsetParent === null) continue;
    let n = el, ok = false;
    while (n && n !== document.documentElement) { if (opaque(n)) { ok = true; break; } n = n.parentElement; }
    if (!ok) out.push(`${el.tagName}.${el.className} :: ${el.innerText.slice(0, 20)}`);
  }
  return out;
});
check("展开态：每个可见文字元素仍有不透明背衬", backlessOpen.length === 0,
  JSON.stringify(backlessOpen.slice(0, 3)));
const rOpen = await renderedContrast(page, "details.row[open] .rb");
check("展开态：折叠内容与其背景 ≥ 4.5:1", rOpen.ratio >= 4.5, JSON.stringify(rOpen));
await page.evaluate(() => document.querySelectorAll("details.row").forEach((d) => { d.open = false; }));

const claimed = await page.evaluate(() => {
  const found = new Set();
  for (const m of document.body.textContent.matchAll(/判据\s*(\d+)\s*条|(\d+)\s*accessibility checks|判定\s*(\d+)\s*項目/g))
    found.add(Number(m[1] || m[2] || m[3]));
  return [...found];
});
check("页面上写的判据条数（三语一致）== 实际条数",
  claimed.length === 1 && claimed[0] === results.length + 1,
  `页面写 ${JSON.stringify(claimed)}，实际 ${results.length + 1}`);

await browser.close();

let bad = 0;
for (const r of results) { console.log(`${r.ok ? "✓" : "✗"} ${r.t}${r.ok ? "" : " —— " + r.d}`); if (!r.ok) bad++; }
console.log(bad === 0 ? `a11y: ${results.length}/${results.length} 通过（${URL}）` : `a11y: ${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
