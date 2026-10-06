// 生成站点：3 个页面 × 3 种语言 = 9 个文件，全部来自 src/content.mjs 这一份来源。
//
//   node src/build.mjs           生成
//   node src/build.mjs --check   只比对：磁盘上的产物必须与来源一致（用于判据）
//
// 为什么要有 --check：多页之后最大的风险是「改了来源忘了重新生成」，
// 于是线上跑的是旧内容，而谁都不知道。这条判据让那种情况**必须红**。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, LANGS, pageHref } from "./layout.mjs";
import { CONTENT, NAV, PAGES } from "./content.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const CHECKS = process.env.SITE_CHECK_COUNT || "70";   // 由 check-a11y 传入真实条数
const DATE = process.env.SITE_DATE || "2026-10-06";

// 每页取哪些小节（0-based 索引进 CONTENT[lang].sections）
const PAGE_SECTIONS = { index: [], work: [0, 1, 2], commission: [3, 4] };

function navList(lang, page) {
  const items = PAGES.map((p) => ({ ...p, label: NAV[lang][p.id], hint: NAV[lang][p.id + "Hint"] || "" }));
  return { items, here: items.find((p) => p.id === page.id),
           others: items.filter((p) => p.id !== page.id) };
}

function bodyFor(lang, page) {
  const { hero, sections } = CONTENT[lang];
  const parts = [];
  // 首页放 hero；其它页放一个同形的页头（标题 + 该页定位的那句话）
  if (page.id === "index") parts.push(hero);
  else parts.push(hero.replace(/<ul class="chips">[\s\S]*?<\/ul>/, ""));   // 子页保留标题与定位，去掉 chips
  for (const i of PAGE_SECTIONS[page.id]) parts.push(sections[i]);
  // 首页补一块「目录」——抽屉在层叠底部，来的人未必找得到它。
  if (page.id === "index") {
    const items = navList(lang, page).items;
    const rows = items.map((p) => `      <div class="row"><dt><a href="${pageHref(lang, p)}">`
      + `<span class="num">${p.num}</span> ${p.label}</a>`
      + `<span class="meta">${p.hint}</span></dt></div>`).join("\n");
    const unit = { zh: "页", en: "pages", ja: "ページ" }[lang];
    parts.push(`  <h2 id="${lang}-nav"><span>${NAV[lang].index}</span><span class="hmeta">${items.length} ${unit}</span></h2>
  <div class="panel">
    <p class="phead"><span>${NAV[lang].index}</span><span>03 ${NAV[lang].commission}</span></p>
    <dl class="rows">
${rows}
    </dl>
  </div>`);
  }
  // 正文里的 {n} 也要替换成真实条数——这样「页面上写的条数」只有一处来源。
  return parts.join("\n").replace(/\{n\}/g, CHECKS);
}

let bad = 0;
for (const lang of Object.keys(LANGS)) {
  for (const page of PAGES) {
    const nav = navList(lang, page).others.concat([navList(lang, page).here]);
    const html = render({
      lang, page: { ...page, label: NAV[lang][page.id], desc: NAV[lang][page.id] },
      nav: PAGES.map((p) => ({ ...p, label: NAV[lang][p.id] })),
      body: bodyFor(lang, page), checks: CHECKS, date: DATE,
    });
    const file = join(ROOT, LANGS[lang].path, page.file);
    if (CHECK) {
      const onDisk = existsSync(file) ? readFileSync(file, "utf8") : "";
      if (onDisk !== html) { console.error(`✗ 产物与来源不一致：${LANGS[lang].path}${page.file}`); bad++; }
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, html);
      console.log(`写出 ${LANGS[lang].path}${page.file}（${html.length} 字节）`);
    }
  }
}
if (CHECK) {
  console.log(bad === 0 ? "build --check：9 个产物都与来源一致" : `build --check：${bad} 个文件不一致`);
  process.exit(bad === 0 ? 0 : 1);
}
