// preview.mjs —— 生成预览图（三种语言 + 高对比度）。
//
// 跑法：node preview.mjs [输出目录]
//
// **为什么字体要写死在脚本里**：本机 chromium 默认没有中文字体，忘了配 fontconfig
// 就会拍出一堆豆腐块（□）——而它**不报错**，看起来只是「字没渲染好」，很容易被当成
// 页面问题。2026-10-06 我因为这个踩了两次，所以让脚本自己带配置，不靠记性。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { readdirSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = process.argv[2] || "/tmp/site-preview";
const URL = process.env.SITE_URL || "https://grg41.github.io/";
mkdirSync(OUT, { recursive: true });

// 找到一个 CJK 字体，随手写一份 fontconfig——**不依赖环境里已经配好**。
function cjkFontDir() {
  const store = "/nix/store";
  for (const d of readdirSync(store)) {
    if (/^[a-z0-9]+-noto-fonts-cjk-sans-/.test(d)) return `${store}/${d}/share/fonts`;
  }
  return null;
}
const fontDir = cjkFontDir();
if (fontDir === null) {
  console.error("找不到 CJK 字体 —— 预览图会全是豆腐块。**这不是「拍好了」**，是没拍成。");
  process.exit(2);
}
const conf = `${OUT}/fonts.conf`;
execFileSync("bash", ["-lc", `mkdir -p ${OUT}/fontcache && cat > ${conf} <<'EOF'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDir}</dir>
  <cachedir>${OUT}/fontcache</cachedir>
</fontconfig>
EOF`]);
process.env.FONTCONFIG_FILE = conf;                       // 必须在启动 chromium 之前

const { chromium } = require(process.env.AB_PLAYWRIGHT || "/home/kix/reclip/node_modules/playwright/index.js");
const exe = process.env.AB_CHROMIUM || execFileSync("bash", ["-lc",
  "ls -1d /nix/store/*chromium-*/bin/chromium 2>/dev/null | head -1"]).toString().trim();

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
async function shot(name, { locale = "zh-CN", hc = false, width = 1280 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 950 }, deviceScaleFactor: 2, locale });
  await page.goto(URL, { waitUntil: "load" });
  if (hc) await page.check("#hc");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  // **不假装能自动判字形覆盖**：我试过量 h1 宽度——那是块级元素的容器宽度，
  // 与字形无关（第一版就是这么「过」的）。所以这里只保证「字体已配好」，
  // 并明确留一句：**出图之后要有人看一眼**。
  await page.close();
  console.log(`${name}.png（${locale}${hc ? " 高对比度" : ""}）`);
}
await shot("zh");
await shot("en", { locale: "en-US" });
await shot("ja", { locale: "ja-JP" });
await shot("hc", { hc: true });
await browser.close();
console.log(`字体：${fontDir}`);
console.log("提醒：字形覆盖不在自动判据里 —— 出图之后要有人（或我）看一眼。");
