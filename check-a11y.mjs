// check-a11y.mjs —— 站点声明的每一件事，都用真浏览器核对。
//
//   node check-a11y.mjs                   核对线上
//   node check-a11y.mjs file:///tmp/site/index.html   核对本地产物
//
// 结构变了（多页 + 抽屉在层叠底部 + 语言是真链接），所以这份判据重写过一次：
// 旧版是围绕「单页 + popover 抽屉 + 语言块切换」写的，打补丁只会越补越乱。
//
// **已知边界**：本判据量布局、对比度、结构、无 JS 行为、跨页一致性；
// **不量字形覆盖**——本机 chromium 默认没有中文字体，截图会全是豆腐块而判据照样绿。
// 出图前先给 fontconfig 配 CJK 字体（preview.mjs 已把配置写在脚本里）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AB_PLAYWRIGHT || "/home/kix/reclip/node_modules/playwright/index.js");
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || "https://grg41.github.io/";
const LOCAL = URL.startsWith("file://");
const exe = process.env.AB_CHROMIUM || execFileSync("bash", ["-lc",
  "ls -1d /nix/store/*chromium-*/bin/chromium 2>/dev/null | head -1"]).toString().trim();

const results = [];
const check = (t, ok, d = "") => results.push({ t, ok: !!ok, d });
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [hi, lo] = [a, b].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const parseRgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
const colorsOf = (pg) => pg.evaluate(() => {
  const p = document.querySelector("p.lead") || document.body;
  return { fg: getComputedStyle(p).color, bg: getComputedStyle(document.body).backgroundColor }; });

// 背衬不变量：每个可见文字元素都必须坐在不透明表面上（body 有背景图 → 不算）
const BACKLESS = (extra = "") => {
  const opaque = (el) => {
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== "none") return false;
    const m = cs.backgroundColor.match(/[\d.]+/g) || [];
    if (m.length < 3) return false;
    return (m.length >= 4 ? Number(m[3]) : 1) >= 0.9;
  };
  const out = [];
  for (const el of document.querySelectorAll("h1, p, li, dt, dd, a, label, kbd, code, .num, time, summary, .rb" + extra)) {
    if (el.offsetParent === null) continue;
    let n = el, ok = false;
    while (n && n !== document.documentElement) { if (opaque(n)) { ok = true; break; } n = n.parentElement; }
    if (!ok) out.push(`${el.tagName}.${el.className} :: ${el.innerText.slice(0, 20)}`);
  }
  return out;
};

// 渲染像素：量「文字跟它**实际**的背景」的对比度（声明的颜色看不见背景图）
async function renderedContrast(pg, selector) {
  const el = pg.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (box === null) return { err: "找不到元素 " + selector };
  const vp = pg.viewportSize();
  const x = Math.max(0, Math.min(box.x, vp.width - 2)), y = Math.max(0, Math.min(box.y, vp.height - 2));
  const clip = { x, y, width: Math.max(2, Math.min(box.width, vp.width - x)),
                 height: Math.max(2, Math.min(box.height, vp.height - y)) };
  const buf = await pg.screenshot({ clip });
  const fg = await el.evaluate((n) => getComputedStyle(n).color);
  return await pg.evaluate(async ({ src, fg }) => {
    const img = new Image(); img.src = src; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const L = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bins = new Array(20).fill(0);
    for (let i = 0; i < d.length; i += 4) bins[Math.min(19, Math.floor(L(d[i], d[i + 1], d[i + 2]) * 20))]++;
    let mode = 0; for (let i = 1; i < 20; i++) if (bins[i] > bins[mode]) mode = i;
    const bg = (mode + 0.5) / 20;
    const t = (fg.match(/\d+/g) || []).slice(0, 3).map(Number);
    const fgl = L(t[0] || 0, t[1] || 0, t[2] || 0);
    const [hi, lo] = [bg, fgl].sort((a, b) => b - a);
    return { bg: +bg.toFixed(3), fg: +fgl.toFixed(3), ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2) };
  }, { src: "data:image/png;base64," + buf.toString("base64"), fg });
}

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });

// ── 本页（完整套件）──────────────────────────────────────────────────────────
let page = await browser.newPage({ viewport: { width: 320, height: 800 }, locale: "zh-CN" });
await page.goto(URL, { waitUntil: "load" });

const overflow = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
check("320px 宽无横向溢出", overflow.sw <= overflow.iw + 1, JSON.stringify(overflow));
const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
check("基准字号 ≥ 20px", fs >= 20, `${fs}px`);
let c = await colorsOf(page);
const crDefault = ratio(lum(parseRgb(c.fg)), lum(parseRgb(c.bg)));
check("默认档对比度 ≥ 7:1", crDefault >= 7, crDefault.toFixed(2) + ":1");
check("默认是暗色（背景暗、前景亮）", lum(parseRgb(c.bg)) < 0.2 && lum(parseRgb(c.fg)) > 0.5,
  `bg=${lum(parseRgb(c.bg)).toFixed(3)} fg=${lum(parseRgb(c.fg)).toFixed(3)}`);
const decl = await page.evaluate(() => ({
  meta: document.querySelector('meta[name="color-scheme"]')?.content ?? null,
  lock: document.querySelector('meta[name="darkreader-lock"]') !== null,
  css: getComputedStyle(document.documentElement).colorScheme }));
check("color-scheme 只声明 dark（不声称支持亮色）",
  decl.meta === "dark" && /dark/.test(decl.css) && !/light/.test(decl.css), JSON.stringify(decl));
check("声明 darkreader-lock（阻止扩展二次暗色化）", decl.lock);
check("页面上不再有亮色开关", (await page.$("input#lt")) === null && (await page.$("label[for=lt]")) === null);
const first = await page.evaluate(() => { const el = document.querySelector("a, button, input, summary");
  return el ? (el.className || el.tagName) : null; });
check("首个可聚焦元素是跳转链接", String(first).includes("skip"), String(first));
check("每个可见文字元素都有不透明背衬", (await page.evaluate(BACKLESS)).length === 0,
  JSON.stringify((await page.evaluate(BACKLESS)).slice(0, 3)));
for (const [sel, min, label] of [["header.hero h1", 7, "标题"], ["header.hero .lead", 7, "副标题"],
                                 ["header.hero .muted", 4.5, "次要文字"], ["main p", 7, "正文段落"]]) {
  const r = await renderedContrast(page, sel);
  check(`渲染像素(320px)：${label} 与其实际背景 ≥ ${min}:1`, r.ratio >= min, JSON.stringify(r));
}
const wide = await browser.newPage({ viewport: { width: 1280, height: 950 }, locale: "zh-CN" });
await wide.goto(URL, { waitUntil: "load" });
for (const [sel, min, label] of [["header.hero h1", 7, "标题"], ["main p", 7, "正文段落"]]) {
  const r = await renderedContrast(wide, sel);
  check(`渲染像素(1280px)：${label} ≥ ${min}:1`, r.ratio >= min, JSON.stringify(r));
}
await wide.close();

// ── 抽屉：**在层叠的底部**，打开时内容让开 ──────────────────────────────────
const drawer = await page.evaluate(() => {
  const d = document.querySelector("details.drawer"), s = document.querySelector(".site"),
        p = document.querySelector(".drawer-panel");
  return { isDetails: d !== null && d.tagName === "DETAILS", open: d ? d.open : null,
           summary: document.querySelector("summary.menubtn") !== null,
           zSite: s ? getComputedStyle(s).zIndex : null, zPanel: p ? getComputedStyle(p).zIndex : null,
           siblings: d && s ? d.parentElement === s.parentElement : false };
});
check("抽屉是原生 details（不靠脚本开关）", drawer.isDetails && drawer.summary && !drawer.open, JSON.stringify(drawer));
check("抽屉是内容层的**兄弟**节点，且 z-index 更低（层级意义上的底部）",
  drawer.siblings && Number(drawer.zSite) > Number(drawer.zPanel), JSON.stringify(drawer));

await page.locator("summary.menubtn").click();
await page.waitForTimeout(420);     // 内容右移有 240ms 过渡，量早了读到 0（同 no-JS 那条）
const opened = await page.evaluate(() => {
  const d = document.querySelector("details.drawer"), s = document.querySelector(".site");
  const m = new DOMMatrixReadOnly(getComputedStyle(s).transform);
  const p = document.querySelector(".drawer-panel").getBoundingClientRect();
  const hit = document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2);
  return { open: d.open, shifted: Math.round(m.m41), panelWidth: Math.round(p.width),
           hitInside: !!(hit && hit.closest(".drawer-panel")) };
});
check("点按钮能展开抽屉", opened.open, JSON.stringify(opened));
check("展开时内容右移（把抽屉让出来，而不是盖上）", opened.shifted > 100, JSON.stringify(opened));
check("展开后抽屉可点（没有被内容层盖住）", opened.hitInside, JSON.stringify(opened));
await page.keyboard.press("Tab");
check("展开后按 Tab 能进入抽屉", await page.evaluate(() => document.querySelector(".drawer-panel").contains(document.activeElement)));
await page.keyboard.press("Escape");
const closed = await page.evaluate(() => ({
  open: document.querySelector("details.drawer").open,
  focusBack: document.activeElement === document.querySelector("summary.menubtn") }));
check("Esc 能关闭抽屉（增强），焦点回到按钮", !closed.open && closed.focusBack, JSON.stringify(closed));

// ── 站内链接：必须是**真链接**且都指向存在的文件 ─────────────────────────────
const links = await page.evaluate(() => ({
  nav: [...document.querySelectorAll(".drawer-panel ul a")].map((a) => ({ href: a.getAttribute("href"), cur: a.getAttribute("aria-current") })),
  lang: [...document.querySelectorAll(".bar .lang a")].map((a) => ({ href: a.getAttribute("href"), cur: a.getAttribute("aria-current"), lang: a.getAttribute("hreflang") })),
}));
check("抽屉内正好三个页面链接，且当前页恰好标一个 aria-current",
  links.nav.length === 3 && links.nav.filter((l) => l.cur === "page").length === 1, JSON.stringify(links.nav));
check("顶栏语言是真链接（三个），当前语言标 aria-current",
  links.lang.length === 3 && links.lang.filter((l) => l.cur === "true").length === 1, JSON.stringify(links.lang));
if (LOCAL) {
  const missing = [];
  for (const l of [...links.nav, ...links.lang]) {
    const rel = l.href.replace(/^\//, "");
    const f = join(ROOT, rel === "" ? "index.html" : (rel.endsWith("/") ? rel + "index.html" : rel));
    if (!existsSync(f)) missing.push(l.href);
  }
  check("所有站内链接都指向**存在**的文件", missing.length === 0, JSON.stringify(missing));
}

// ── 折叠条目 / 计数 / 自洽 ───────────────────────────────────────────────────
const details = await page.evaluate(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const all = [...document.querySelectorAll("details.row")];
  if (all.length === 0) return { n: 0 };
  const withBody = all.filter((d) => (d.querySelector(".rb")?.textContent || "").trim().length > 15).length;
  const d0 = all[0], body = d0.querySelector(".rb");
  d0.open = true; await frame();
  const visibleWhenOpen = body.getBoundingClientRect().height > 4;
  d0.open = false; await new Promise((r) => setTimeout(r, 450));
  return { n: all.length, withBody, visibleWhenOpen, hiddenWhenClosed: body.getBoundingClientRect().height === 0 };
});
check("可折叠条目（若本页有）都有内容、展开可见、收起不占位",
  details.n === 0 || (details.withBody === details.n && details.visibleWhenOpen && details.hiddenWhenClosed),
  JSON.stringify(details));
const counter = await page.evaluate(() => {
  const out = [];
  for (const h2 of document.querySelectorAll("main > h2[id]")) {
    const meta = h2.querySelector(".hmeta"); if (!meta) continue;
    const want = Number((meta.textContent.match(/\d+/) || [])[0]);
    const panel = h2.nextElementSibling;
    const got = panel ? panel.querySelectorAll(":scope > details.row, :scope > .rows > .row").length : -1;
    if (want !== got) out.push({ id: h2.id, want, got });
  }
  return out;
});
check("各节声明的条目数 == 该节实际条目数", counter.length === 0, JSON.stringify(counter));

// ── 减少动效 / 允许动效 ──────────────────────────────────────────────────────
await page.emulateMedia({ reducedMotion: "reduce" });
const still = await page.evaluate(() => {
  const a = document.querySelector(".lang a"), rb = document.querySelector("details.row .rb");
  const cs = rb ? getComputedStyle(rb) : null;
  return { transition: getComputedStyle(a).transitionDuration, anim: getComputedStyle(a).animationName,
           siteTransition: getComputedStyle(document.querySelector(".site")).transitionDuration,
           rbOpacity: cs ? cs.opacity : "1" };
});
check("减少动效时无过渡（含内容层）", /^(0s,?\s*)+$/.test(still.transition) && /^(0s,?\s*)+$/.test(still.siteTransition), JSON.stringify(still));
check("减少动效时无动画", still.anim === "none", JSON.stringify(still));
check("减少动效时内容仍然可见（动效不是内容的前提）", Number(still.rbOpacity) === 1, JSON.stringify(still));
await page.emulateMedia({ reducedMotion: "no-preference" });
const motion = await page.evaluate(() => {
  const nz = (v) => v.split(",").some((x) => parseFloat(x) > 0);
  return { site: nz(getComputedStyle(document.querySelector(".site")).transitionDuration),
           tab: nz(getComputedStyle(document.querySelector(".lang a")).transitionDuration) };
});
check("允许动效时抽屉与页签都有过渡（动效真的存在）", motion.site && motion.tab, JSON.stringify(motion));

// ── 无 JavaScript ───────────────────────────────────────────────────────────
const noJs = await browser.newContext({ javaScriptEnabled: false });
const p2 = await noJs.newPage({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
const resp = await p2.goto(URL, { waitUntil: "load" });
const zhText = await p2.evaluate(() => document.querySelector("main").innerText);
check("禁 JS 仍返回 200 且有正文", resp.status() === 200 && zhText.length > 150, `HTTP ${resp.status()} / ${zhText.length} 字`);
await p2.locator("summary.menubtn").click();
await p2.waitForTimeout(420);        // 内容右移有 240ms 过渡，量早了会读到 0（第一版就是这么错的）
const noJsOpen = await p2.evaluate(() => {
  const d = document.querySelector("details.drawer");
  const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".site")).transform);
  return { open: d.open, shifted: Math.round(m.m41) };
});
check("禁 JS 也能展开抽屉并把内容让开（原生 details + CSS）", noJsOpen.open && noJsOpen.shifted > 100, JSON.stringify(noJsOpen));
const noJsLang = await p2.evaluate(() => {
  const as = [...document.querySelectorAll(".bar .lang a")].map((a) => a.getAttribute("href") || "");
  return { n: as.length, hrefs: as, ok: as.length === 3 && as.every((h) => h.startsWith("/")) };
});
check("禁 JS 时语言切换仍可用（链接是真链接）", noJsLang.ok, JSON.stringify(noJsLang));
await noJs.close();

// ── 跨页：9 个产物都要过一遍核心不变量 ───────────────────────────────────────
if (LOCAL) {
  const files = ["index.html", "work.html", "commission.html",
                 "en/index.html", "en/work.html", "en/commission.html",
                 "ja/index.html", "ja/work.html", "ja/commission.html"];
  const bad = { backless: [], text: [], mixed: [], lang: [] };
  for (const f of files) {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
    await pg.goto("file://" + join(ROOT, f), { waitUntil: "load" });
    const r = await pg.evaluate(() => ({
      backless: window.__backless ? [] : [],
      text: document.querySelector("main").innerText.length,
      lang: document.documentElement.lang,
      hreflang: document.querySelectorAll('link[rel="alternate"]').length,
      canonical: !!document.querySelector('link[rel="canonical"]'),
      body: document.body.innerText,
    }));
    const bl = await pg.evaluate(BACKLESS);
    if (bl.length) bad.backless.push({ f, bl: bl.slice(0, 2) });
    if (r.text < 150) bad.text.push(f);
    if (r.hreflang !== 3 || !r.canonical) bad.lang.push(f);
    // 语言切换器（中文 / English / 日本語）与品牌名**本来就该用各自的语言写**，
    // 所以排除它们再看——第一版没排除，把正确的东西报成了「混语言」。
    const isEn = f.startsWith("en/");
    const scoped = await pg.evaluate(() => {
      const clone = document.querySelector("main").cloneNode(true);
      return clone.innerText;
    });
    const leftover = (scoped.replace(/小爪|キツのめ|Kitsunome/g, "").match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []);
    if (isEn && leftover.length) bad.mixed.push({ f, chars: [...new Set(leftover)].slice(0, 8) });
    await pg.close();
  }
  check("跨页：9 个产物都有正文（≥150 字）、都有 hreflang×3 与 canonical", bad.text.length === 0 && bad.lang.length === 0,
    JSON.stringify(bad.text.concat(bad.lang)));
  check("跨页：9 个产物的背衬不变量都成立", bad.backless.length === 0, JSON.stringify(bad.backless));
  check("跨页：英文页面不混中日文字符", bad.mixed.length === 0, JSON.stringify(bad.mixed));
}

// ── 生成物与来源不许漂移 ─────────────────────────────────────────────────────
if (LOCAL) {
  let drift = "";
  try {
    execFileSync("node", [join(ROOT, "src", "build.mjs"), "--check"], {
      cwd: ROOT, env: { ...process.env, SITE_CHECK_COUNT: String(claimed[0] ?? "") }, encoding: "utf8" });
  } catch (e) { drift = (e.stdout || "") + (e.stderr || ""); }
  check("产物与来源一致（build --check 无漂移）", drift === "" || /都与来源一致/.test(drift), drift.slice(-200));
}

// ── 自洽：页面上写的判据条数 == 实际条数（**必须是最后一条**）─────────────────
// 第一版放在倒数第二条，于是「+1」把后面那条判据算漏了：页面写 38、实际 39，
// 它居然过了 —— 一条**假绿**。自洽检查只有排在最后，「+1」才成立。
const claimed = await page.evaluate(() => {
  const found = new Set();
  for (const m of document.body.textContent.matchAll(/判据\s*(\d+)\s*条|(\d+)\s*runnable checks|判定\s*(\d+)\s*項目/g))
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
