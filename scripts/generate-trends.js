#!/usr/bin/env node

/**
 * 趋势词发现器 v4 - 超级稳定版
 * 绝对不会失败
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  outputDir: path.join(__dirname, '..', 'trends'),
};

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// 超级安全的 HTTP 请求
function safeFetch(url, timeout = 10000) {
  return new Promise((resolve) => {
    try {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: timeout
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ ok: true, data }));
        res.on('error', () => resolve({ ok: false }));
      });
      req.on('error', () => resolve({ ok: false }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    } catch (e) {
      resolve({ ok: false });
    }
  });
}

// 安全解析 JSON
function safeJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Wikipedia 热门
async function fetchWikipedia() {
  console.log('📚 Fetching Wikipedia...');
  const trends = [];
  try {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${year}/${month}/${day}`;
    const res = await safeFetch(url);

    if (!res.ok) {
      console.log('   ⚠️ Wikipedia failed');
      return trends;
    }

    const json = safeJSON(res.data);
    if (!json?.items?.[0]?.articles) {
      console.log('   ⚠️ Wikipedia no data');
      return trends;
    }

    const skip = ['Main_Page', 'Special:', 'Wikipedia:', 'Portal:', 'File:'];
    let count = 0;
    for (const a of json.items[0].articles) {
      if (skip.some(s => a.article.includes(s))) continue;
      count++;
      // 跳过前9个，取第10-20名
      if (count < 10) continue;
      trends.push({
        keyword: a.article.replace(/_/g, ' '),
        traffic: `${Math.round(a.views / 1000)}K`,
        source: 'Wiki',
      });
      if (trends.length >= 11) break;
    }
    console.log(`   ✅ Got ${trends.length} items`);
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
  }
  return trends;
}

// Hacker News
async function fetchHN() {
  console.log('🔶 Fetching HackerNews...');
  const trends = [];
  try {
    const res = await safeFetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    if (!res.ok) {
      console.log('   ⚠️ HN failed');
      return trends;
    }

    const ids = safeJSON(res.data);
    if (!Array.isArray(ids)) {
      console.log('   ⚠️ HN no data');
      return trends;
    }

    for (const id of ids.slice(0, 10)) {
      const itemRes = await safeFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!itemRes.ok) continue;

      const item = safeJSON(itemRes.data);
      if (!item?.title) continue;

      let kw = item.title;
      if (kw.includes(':')) kw = kw.split(':')[0].trim();
      if (kw.length > 50) kw = kw.slice(0, 47) + '...';

      trends.push({
        keyword: kw,
        traffic: `${item.score} pts`,
        source: 'HN',
      });
    }
    console.log(`   ✅ Got ${trends.length} items`);
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
  }
  return trends;
}


// 去重
function dedupe(arr) {
  const seen = new Set();
  return arr.filter(t => {
    const k = t.keyword.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 生成 HTML
function makeHTML(trends, date) {
  const colors = { Wiki: '#000', HN: '#f60' };

  const items = trends.slice(0, 30).map((t, i) => `
    <div class="item">
      <span class="num">${i + 1}</span>
      <div class="info">
        <span class="kw">${t.keyword}</span>
        <span class="src" style="background:${colors[t.source] || '#666'}">${t.source}</span>
        <span class="tr">${t.traffic}</span>
      </div>
      <div class="links">
        <a href="https://www.google.com/search?q=${encodeURIComponent(t.keyword)}" target="_blank">G</a>
        <a href="https://trends.google.com/trends/explore?q=${encodeURIComponent(t.keyword)}" target="_blank">T</a>
      </div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Trends ${date}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui;background:#111;color:#eee;padding:20px}
    .box{max-width:600px;margin:0 auto}
    h1{font-size:18px;color:#0f8;margin-bottom:20px;text-align:center}
    .item{display:flex;align-items:center;gap:10px;padding:10px;background:#1a1a1a;margin-bottom:6px;border-radius:4px}
    .item:hover{background:#222}
    .num{color:#f80;font-weight:bold;min-width:24px}
    .info{flex:1}
    .kw{font-weight:600}
    .src{font-size:11px;padding:1px 4px;border-radius:2px;color:#fff;margin-left:6px}
    .tr{font-size:12px;color:#888;margin-left:6px}
    .links{display:flex;gap:4px}
    .links a{color:#08f;text-decoration:none;padding:2px 6px;border:1px solid #333;border-radius:3px;font-size:12px}
    .links a:hover{background:#222}
    .nav{margin-top:20px;text-align:center}
    .nav a{color:#08f;text-decoration:none;margin:0 10px}
  </style>
</head>
<body>
  <div class="box">
    <h1>TRENDS ${date}</h1>
    ${items}
    <div class="nav">
      <a href="./">Archive</a>
      <a href="../">Home</a>
    </div>
  </div>
</body>
</html>`;
}

// 索引页
function makeIndex(files) {
  const list = files.sort((a,b) => b.localeCompare(a)).slice(0, 30)
    .map(f => `<a href="./${f}">${f.replace('.html','')}</a>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Trends Archive</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui;background:#111;color:#eee;padding:40px 20px;text-align:center}
    h1{font-size:16px;color:#0f8;margin-bottom:20px}
    a{display:block;color:#eee;text-decoration:none;padding:10px;background:#1a1a1a;margin:4px auto;max-width:300px;border-radius:4px}
    a:hover{background:#222;color:#0f8}
    .back{margin-top:20px;color:#08f}
  </style>
</head>
<body>
  <h1>ARCHIVE</h1>
  ${list}
  <a href="../" class="back">← Home</a>
</body>
</html>`;
}

// 主函数
async function main() {
  const today = getToday();
  console.log(`\n📅 ${today}\n`);

  // 获取数据
  const wiki = await fetchWikipedia();
  const hn = await fetchHN();

  // 合并
  let all = dedupe([...wiki, ...hn]);
  console.log(`\n✅ Total: ${all.length} keywords\n`);

  // 确保目录存在
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  // 写入文件
  const file = path.join(CONFIG.outputDir, `${today}.html`);
  fs.writeFileSync(file, makeHTML(all, today));
  console.log(`📄 ${file}`);

  // 更新索引
  const files = fs.readdirSync(CONFIG.outputDir).filter(f => f.endsWith('.html') && f !== 'index.html');
  fs.writeFileSync(path.join(CONFIG.outputDir, 'index.html'), makeIndex(files));
  console.log(`📄 index.html`);

  console.log('\n🎉 Done!\n');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
