// scripts/fetch_rss_cache.js
// Генерит news_cache.json из Google News RSS

const fs = require("fs");

const QUERY = process.env.RSS_QUERY || "мазут Анапа Краснодар";
const RSS_URL =
  "https://news.google.com/rss/search?q=" +
  encodeURIComponent(QUERY) +
  "&hl=ru&gl=RU&ceid=RU:ru";

async function main() {
  const res = await fetch(RSS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (rss-cache-bot)" },
  });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xmlText = await res.text();

  // Мини-парсер XML без зависимостей (достаточно для RSS item/title/link/pubDate/source)
  const items = [];
  const itemBlocks = xmlText.split("<item>").slice(1);

  for (const block of itemBlocks.slice(0, 30)) {
    const pick = (tag) => {
      const a = block.indexOf(`<${tag}`);
      if (a === -1) return "";
      const b = block.indexOf(">", a);
      const c = block.indexOf(`</${tag}>`, b);
      if (b === -1 || c === -1) return "";
      return block.slice(b + 1, c).trim();
    };

    const title = pick("title");
    const link = pick("link");
    const pubDate = pick("pubDate");

    // <source url="...">NAME</source>
    let source = "";
    const sOpen = block.indexOf("<source");
    if (sOpen !== -1) {
      const sGT = block.indexOf(">", sOpen);
      const sClose = block.indexOf("</source>", sGT);
      if (sGT !== -1 && sClose !== -1) source = block.slice(sGT + 1, sClose).trim();
    }

    // простая чистка HTML entities
    const unescape = (t) =>
      t.replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">");

    items.push({
      title: unescape(title),
      link: unescape(link),
      pubDate: unescape(pubDate),
      source: unescape(source),
    });
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    query: QUERY,
    source: "google_news_rss",
    items,
  };

  fs.writeFileSync("news_cache.json", JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Saved ${items.length} items -> news_cache.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
