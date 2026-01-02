#!/usr/bin/env node

/**
 * 趋势词发现器 v5 - 多源50条版
 * 数据源: X(getdaytrends) + Reddit(PullPush) + HackerNews + Wikipedia
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
function safeFetch(url, timeout = 15000) {
  return new Promise((resolve) => {
    try {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
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

// ============ X/Twitter via getdaytrends ============
async function fetchXTrends() {
  console.log('🐦 Fetching X/Twitter (getdaytrends)...');
  const trends = [];
  try {
    const res = await safeFetch('https://getdaytrends.com/united-states/', 20000);
    if (!res.ok) {
      console.log('   ⚠️ X Trends failed');
      return trends;
    }

    const matches = res.data.matchAll(/<a[^>]*href="\/united-states\/trend\/[^"]*"[^>]*>([^<]+)<\/a>/gi);
    const seen = new Set();
    for (const m of matches) {
      let topic = m[1].trim();
      if (!topic || topic.length < 2 || seen.has(topic.toLowerCase())) continue;
      if (['twitter', 'trending', 'trends'].includes(topic.toLowerCase())) continue;
      seen.add(topic.toLowerCase());
      trends.push({
        keyword: topic,
        traffic: '🔥',
        source: 'X',
      });
      if (trends.length >= 50) break;
    }
    console.log(`   ✅ Got ${trends.length} items`);
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
  }
  return trends;
}

// ============ Reddit via PullPush API ============
async function fetchReddit() {
  console.log('📱 Fetching Reddit (PullPush)...');
  const trends = [];
  const subreddits = ['technology', 'programming', 'artificial', 'startups', 'webdev', 'machinelearning'];

  try {
    for (const sub of subreddits) {
      const url = `https://api.pullpush.io/reddit/search/submission/?subreddit=${sub}&sort=score&size=10`;
      const res = await safeFetch(url, 10000);
      if (!res.ok) continue;

      const json = safeJSON(res.data);
      if (!json?.data) continue;

      for (const post of json.data) {
        let title = post.title;
        if (!title) continue;

        // 清理标题
        title = title.replace(/^\[.*?\]\s*/, '').trim();
        if (title.length > 60) title = title.slice(0, 57) + '...';

        trends.push({
          keyword: title,
          traffic: `${post.score || 0} pts`,
          source: 'Reddit',
        });
      }

      if (trends.length >= 50) break;
    }
    console.log(`   ✅ Got ${trends.length} items`);
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
  }
  return trends.slice(0, 50);
}

// ============ HackerNews ============
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

    // 取前50个
    for (const id of ids.slice(0, 50)) {
      const itemRes = await safeFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!itemRes.ok) continue;

      const item = safeJSON(itemRes.data);
      if (!item?.title) continue;

      let kw = item.title;
      if (kw.length > 60) kw = kw.slice(0, 57) + '...';

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

// ============ Wikipedia (从第5个开始取50个) ============
async function fetchWikipedia() {
  console.log('📚 Fetching Wikipedia (5th-55th)...');
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

    const skip = ['Main_Page', 'Special:', 'Wikipedia:', 'Portal:', 'File:', 'Help:', 'Template:'];
    let count = 0;
    for (const a of json.items[0].articles) {
      if (skip.some(s => a.article.includes(s))) continue;
      count++;
      // 从第5个开始取
      if (count < 5) continue;
      trends.push({
        keyword: a.article.replace(/_/g, ' '),
        traffic: `${Math.round(a.views / 1000)}K`,
        source: 'Wiki',
      });
      if (trends.length >= 50) break;
    }
    console.log(`   ✅ Got ${trends.length} items`);
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
  }
  return trends;
}

// ============ 去重 ============
function dedupe(arr) {
  const seen = new Set();
  return arr.filter(t => {
    const k = t.keyword.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!k || k.length < 2) return false;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ============ 生成 HTML ============
function makeHTML(trends, date) {
  const colors = {
    X: '#000',
    Reddit: '#ff4500',
    HN: '#f60',
    Wiki: '#1da1f2'
  };

  const items = trends.map((t, i) => `
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
    .box{max-width:700px;margin:0 auto}
    h1{font-size:18px;color:#0f8;margin-bottom:10px;text-align:center}
    .stats{text-align:center;color:#666;font-size:12px;margin-bottom:20px}
    .item{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#1a1a1a;margin-bottom:4px;border-radius:4px}
    .item:hover{background:#222}
    .num{color:#f80;font-weight:bold;min-width:28px;font-size:12px}
    .info{flex:1;overflow:hidden}
    .kw{font-weight:600;font-size:14px}
    .src{font-size:10px;padding:1px 4px;border-radius:2px;color:#fff;margin-left:6px}
    .tr{font-size:11px;color:#888;margin-left:6px}
    .links{display:flex;gap:4px}
    .links a{color:#08f;text-decoration:none;padding:2px 6px;border:1px solid #333;border-radius:3px;font-size:11px}
    .links a:hover{background:#222}
    .nav{margin-top:20px;text-align:center}
    .nav a{color:#08f;text-decoration:none;margin:0 10px}
  </style>
</head>
<body>
  <div class="box">
    <h1>TRENDS ${date}</h1>
    <div class="stats">${trends.length} keywords | X + Reddit + HN + Wiki</div>
    ${items}
    <div class="nav">
      <a href="./">Archive</a>
      <a href="../">Home</a>
    </div>
  </div>
</body>
</html>`;
}

// ============ 索引页 ============
function makeIndex(files) {
  const list = files.sort((a,b) => b.localeCompare(a)).slice(0, 60)
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
  <h1>TRENDS ARCHIVE</h1>
  ${list}
  <a href="../" class="back">← Home</a>
</body>
</html>`;
}

// ============ 主函数 ============
async function main() {
  const today = getToday();
  console.log(`\n📅 ${today}\n`);

  // 并行获取数据
  const [xtrends, reddit, hn, wiki] = await Promise.all([
    fetchXTrends(),
    fetchReddit(),
    fetchHN(),
    fetchWikipedia(),
  ]);

  // 合并去重
  let all = dedupe([...xtrends, ...reddit, ...hn, ...wiki]);
  console.log(`\n✅ Total: ${all.length} unique keywords\n`);

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
