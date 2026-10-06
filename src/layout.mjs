// 站点外壳：把「一页内容」渲染成完整 HTML。
// 多页之后最容易出的问题是 9 个文件各自漂——所以外壳只有这一份，页面由 build.mjs 生成。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHELL_CSS = readFileSync(join(HERE, "shell.css"), "utf8");

export const LANGS = {
  zh: { htmlLang: "zh-CN", path: "",       label: "中文",     title: "小爪（キツのめ）— 仓库维护与验证工程" },
  en: { htmlLang: "en",    path: "en/",    label: "English",  title: "Kitsunome — repository maintenance & verification" },
  ja: { htmlLang: "ja",    path: "ja/",    label: "日本語",   title: "小爪（キツのめ）— リポジトリ保守と検証" },
};

// 页面在各语言下的地址（跨语言切换就是换目录，**是真链接**，没有 JS 也能切）
export function pageHref(lang, page) {
  const base = LANGS[lang].path;
  return page.id === "index" ? `/${base}` : `/${base}${page.file}`;
}

const UI = {
  zh: { skip: "跳到正文", contents: "目录", site: "站内导航", lang: "语言",
        hc: "高对比度", footer: ["源码即本页", "判据 {n} 条可跑", "<kbd>Tab</kbd> 可达全部控件", "最后更新 <time datetime=\"{d}\">{d}</time>"],
        navTitle: "目录", pageNav: "本页之外" },
  en: { skip: "Skip to content", contents: "Contents", site: "Site navigation", lang: "Language",
        hc: "High contrast", footer: ["Source is this page", "{n} runnable checks", "<kbd>Tab</kbd> reaches every control", "Last updated <time datetime=\"{d}\">{d}</time>"],
        navTitle: "Contents", pageNav: "Other pages" },
  ja: { skip: "本文へ", contents: "目次", site: "サイト内ナビ", lang: "言語",
        hc: "高コントラスト", footer: ["ソースはこのページ", "判定 {n} 項目が実行可能", "<kbd>Tab</kbd> で全操作に到達", "最終更新 <time datetime=\"{d}\">{d}</time>"],
        navTitle: "目次", pageNav: "他のページ" },
};

export function render({ lang, page, nav, body, checks, date }) {
  const L = LANGS[lang], U = UI[lang];
  const here = pageHref(lang, page);
  const alternates = Object.keys(LANGS).map((l) =>
    `<link rel="alternate" hreflang="${LANGS[l].htmlLang}" href="${pageHref(l, page)}">`).join("\n");
  const langLinks = Object.keys(LANGS).map((l) =>
    `<a href="${pageHref(l, page)}" data-lang-link="${l}" hreflang="${LANGS[l].htmlLang}"` +
    `${l === lang ? ' aria-current="true"' : ""}>${LANGS[l].label}</a>`).join("\n        ");
  const navLinks = nav.map((p) =>
    `<li><a href="${pageHref(lang, p)}"${p.id === page.id ? ' aria-current="page"' : ""}>` +
    `<span class="num">${p.num}</span>${p.label}</a></li>`).join("\n        ");
  const foot = U.footer.map((t) => `<li>${t.replace("{n}", checks).replace(/\{d\}/g, date)}</li>`).join("\n    ");

  return `<!doctype html>
<html lang="${L.htmlLang}" data-page="${page.id}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- 默认暗色：向浏览器声明，并阻止「二次暗色化」（浏览器强制暗色 / Dark Reader）。 -->
<meta name="color-scheme" content="dark">
<meta name="darkreader-lock">
<meta name="theme-color" content="#0b0e12">
<title>${L.title}${page.id === "index" ? "" : " — " + page.label}</title>
<meta name="description" content="${page.desc}">
<link rel="canonical" href="${here}">
${alternates}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230e1116'/%3E%3Ctext x='16' y='23' font-size='19' text-anchor='middle' fill='%237cc0ff'%3E%E5%B0%8F%3C/text%3E%3C/svg%3E">
<style>${SHELL_CSS}</style>
</head>
<body>
<a class="skip" href="#main">${U.skip}</a>

<!-- 抽屉在**层叠的底部**：它是内容层（.site）的兄弟节点，z-index 更低。
     打开时内容右移让开，抽屉在下面被露出来 —— 不是盖在内容上（popover 会盖上去，所以没用它）。 -->
<details class="drawer">
  <summary class="menubtn"><span class="burger" aria-hidden="true"></span>${U.contents}</summary>
  <nav class="drawer-panel" aria-label="${U.site}">
    <div class="drawer-head"><strong>${U.navTitle}</strong></div>
    <ul>
        ${navLinks}
    </ul>
    <div class="drawer-lang" aria-label="${U.lang}">
        ${langLinks}
    </div>
  </nav>
</details>

<div class="site">
  <div class="bar">
    <div class="bar-in">
      <p class="brand">小爪 <span>キツのめ</span></p>
      <nav class="lang" aria-label="${U.lang}">
        ${langLinks}
      </nav>
      <span class="toggles">
        <span class="toggle"><input type="checkbox" id="hc"><label for="hc">${U.hc}</label></span>
      </span>
    </div>
  </div>

  <div class="wrap">
    <main id="main">
${body}
    </main>
    <footer><div class="foot">
      <ul class="chips">
    ${foot}
      </ul>
    </div></footer>
  </div>
</div>

<script>
(function () {
  // 语言选择记在本站（跨页面生效）。**没有这段也能用**：语言链接本身就是真链接。
  document.querySelectorAll("[data-lang-link]").forEach(function (a) {
    a.addEventListener("click", function () {
      try { localStorage.setItem("kitsunome-lang", a.getAttribute("data-lang-link")); } catch (e) {}
    });
  });
  // Esc 关闭抽屉。details 原生不支持 Esc，所以这是**增强**——
  // 没有它，键盘用 Tab 到 summary 再按 Enter/Space 一样能关。
  var d = document.querySelector("details.drawer");
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && d && d.open) {
      d.open = false;
      var s = document.querySelector(".menubtn"); if (s) s.focus();
    }
  });
  // 自适应：只在语言根目录、且访客没手动选过时，跳到浏览器偏好的语言。
  try {
    var saved = localStorage.getItem("kitsunome-lang");
    var atRoot = location.pathname === "/" || /\\/index\\.html$/.test(location.pathname);
    if (!saved && atRoot && document.documentElement.getAttribute("data-page") === "index") {
      var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "zh"];
      for (var i = 0; i < prefs.length; i++) {
        var l = String(prefs[i]).toLowerCase();
        if (l.indexOf("zh") === 0) break;
        if (l.indexOf("ja") === 0) { location.replace("/ja/"); break; }
        if (l.indexOf("en") === 0) { location.replace("/en/"); break; }
      }
    }
  } catch (e) {}
})();
</script>
</body>
</html>
`;
}
