#!/usr/bin/env node

/**
 * 趋势词发现器 v3 - 稳定版
 * 只用 100% 免费稳定的公开 API
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  outputDir: path.join(__dirname, '..', 'trends'),
  indexFile: path.join(__dirname, '..', 'trends', 'index.html'),
};

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// 1. Wikipedia 热门页面 (非常稳定)
async function fetchWikipedia() {
  const trends = [];
  try {
    const today = new Date();
    today.setDate(today.getDate() - 1); // 昨天的数据
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${year}/${month}/${day}`;
    const json = await fetchJSON(url);

    const skipList = ['Main_Page', 'Special:', 'Wikipedia:', 'Portal:', 'File:', 'Help:', 'Category:', 'Template:'];
    const articles = json.items?.[0]?.articles || [];

    for (const article of articles) {
      const name = article.article;
      if (skipList.some(s => name.includes(s))) continue;

      const title = name.replace(/_/g, ' ');
      const views = article.views;

      trends.push({
        keyword: title,
        traffic: views > 1000000 ? `${(views/1000000).toFixed(1)}M` : `${Math.round(views/1000)}K`,
        source: 'Wiki',
        views: views,
      });

      if (trends.length >= 15) break;
    }
    console.log(`📚 Wikipedia: ${trends.length} items`);
  } catch (e) {
    console.log(`⚠️ Wikipedia failed: ${e.message}`);
  }
  return trends;
}

// 2. Hacker News Top (非常稳定)
async function fetchHackerNews() {
  const trends = [];
  try {
    const ids = await fetchJSON('https://hacker-news.firebaseio.com/v0/topstories.json');

    for (const id of ids.slice(0, 12)) {
      try {
        const item = await fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        if (!item?.title) continue;

        // 提取关键词
        let keyword = item.title;
        if (keyword.includes(':')) keyword = keyword.split(':')[0].trim();
        if (keyword.includes('–')) keyword = keyword.split('–')[0].trim();
        if (keyword.split(' ').length > 6) {
          keyword = keyword.split(' ').slice(0, 5).join(' ');
        }

        trends.push({
          keyword: keyword,
          traffic: `${item.score} pts`,
          source: 'HN',
          views: item.score,
          url: item.url,
        });
      } catch (e) {}
    }
    console.log(`🔶 HackerNews: ${trends.length} items`);
  } catch (e) {
    console.log(`⚠️ HackerNews failed: ${e.message}`);
  }
  return trends;
}

// 3. Reddit Rising (稳定 - 用 .json 端点)
async function fetchReddit() {
  const trends = [];
  const subs = ['technology', 'programming', 'Futurology', 'gadgets'];

  for (const sub of subs) {
    try {
      const url = `https://www.reddit.com/r/${sub}/hot.json?limit=5`;
      const json = await fetchJSON(url);
      const posts = json?.data?.children || [];

      for (const post of posts.slice(0, 3)) {
        const d = post.data;
        if (!d.title || d.stickied) continue;

        let keyword = d.title;
        if (keyword.length > 60) {
          keyword = keyword.slice(0, 55) + '...';
        }

        trends.push({
          keyword: keyword,
          traffic: `${d.score} ups`,
          source: `r/${sub}`,
          views: d.score,
        });
      }
    } catch (e) {
      console.log(`⚠️ Reddit r/${sub} failed: ${e.message}`);
    }
  }
  console.log(`🔴 Reddit: ${trends.length} items`);
  return trends;
}

// 4. 新兴关键词 (手动维护 - 每周更新)
function getEmergingKeywords() {
  // 这些是手动收集的近期上升词，建议每周更新
  return [
    { keyword: 'DeepSeek R1', traffic: '🔥 Rising', source: 'Curated', views: 9999 },
    { keyword: 'Claude Opus 4', traffic: '🔥 Rising', source: 'Curated', views: 9998 },
    { keyword: 'Gemini 2.0 Flash', traffic: '🔥 Rising', source: 'Curated', views: 9997 },
    { keyword: 'OpenAI o3', traffic: '🔥 Rising', source: 'Curated', views: 9996 },
    { keyword: 'Grok 3', traffic: '🔥 Rising', source: 'Curated', views: 9995 },
    { keyword: 'Apple Intelligence', traffic: '🔥 Rising', source: 'Curated', views: 9994 },
    { keyword: 'Perplexity AI', traffic: '🔥 Rising', source: 'Curated', views: 9993 },
    { keyword: 'Cursor IDE', traffic: '🔥 Rising', source: 'Curated', views: 9992 },
  ];
}

// 合并去重
function mergeTrends(sources) {
  const seen = new Set();
  const all = [];

  for (const trends of sources) {
    for (const t of trends) {
      const key = t.keyword.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 25);
      if (!seen.has(key) && key.length > 2) {
        seen.add(key);
        all.push(t);
      }
    }
  }

  // 按 views 排序
  all.sort((a, b) => (b.views || 0) - (a.views || 0));
  return all;
}

// 生成 HTML
function generateHTML(trends, date) {
  const title = `Trending Keywords ${date}`;

  const sourceColors = {
    'Wiki': '#000000',
    'HN': '#ff6600',
    'Curated': '#2ecc71',
  };

  const trendsHTML = trends.slice(0, 35).map((t, i) => {
    let color = sourceColors[t.source] || '#e74c3c';
    if (t.source.startsWith('r/')) color = '#ff4500';

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(t.keyword)}`;
    const trendsUrl = `https://trends.google.com/trends/explore?q=${encodeURIComponent(t.keyword)}&geo=US`;

    return `
            <div class="trend-item">
                <span class="rank">#${i + 1}</span>
                <div class="trend-content">
                    <div class="keyword-row">
                        <span class="keyword">${t.keyword}</span>
                        <span class="source" style="background:${color}">${t.source}</span>
                    </div>
                    <div class="meta">
                        <span class="traffic">${t.traffic}</span>
                    </div>
                    <div class="actions">
                        <a href="${searchUrl}" target="_blank">Google</a>
                        <a href="${trendsUrl}" target="_blank">Trends</a>
                    </div>
                </div>
            </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <meta name="description" content="Daily trending keywords from Wikipedia, HackerNews, Reddit - ${date}">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@400;600&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            min-height: 100vh;
            background: #0a0a0f;
            color: #e0e0e0;
            padding: 16px;
        }
        .container { max-width: 700px; margin: 0 auto; }
        header {
            text-align: center;
            padding: 24px 16px;
            margin-bottom: 20px;
            background: linear-gradient(180deg, #1a1a24 0%, #12121a 100%);
            border: 1px solid #2a2a3a;
            border-radius: 8px;
        }
        h1 {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.75rem;
            color: #00ff88;
            margin-bottom: 8px;
            letter-spacing: 1px;
        }
        .date {
            font-size: 0.7rem;
            color: #888;
        }
        .trends-list { display: flex; flex-direction: column; gap: 8px; }
        .trend-item {
            display: flex;
            gap: 10px;
            padding: 12px;
            background: #14141c;
            border: 1px solid #1e1e2a;
            border-radius: 6px;
            transition: border-color 0.2s;
        }
        .trend-item:hover { border-color: #00ff88; }
        .rank {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.45rem;
            color: #ffaa00;
            min-width: 28px;
            padding-top: 3px;
        }
        .trend-content { flex: 1; min-width: 0; }
        .keyword-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .keyword {
            font-size: 0.95rem;
            font-weight: 600;
            color: #fff;
            word-break: break-word;
        }
        .source {
            font-size: 0.55rem;
            padding: 2px 5px;
            border-radius: 3px;
            color: #fff;
            white-space: nowrap;
        }
        .meta { margin-top: 4px; font-size: 0.7rem; color: #666; }
        .traffic { background: #1e1e2a; padding: 2px 6px; border-radius: 3px; }
        .actions { margin-top: 6px; display: flex; gap: 6px; }
        .actions a {
            font-size: 0.65rem;
            color: #00aaff;
            text-decoration: none;
            padding: 2px 6px;
            border: 1px solid #2a2a3a;
            border-radius: 3px;
        }
        .actions a:hover { background: #1e1e2a; border-color: #00aaff; }
        .nav-links { margin-top: 20px; display: flex; gap: 12px; }
        .nav-links a {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.4rem;
            color: #00aaff;
            text-decoration: none;
        }
        footer {
            text-align: center;
            margin-top: 24px;
            font-size: 0.6rem;
            color: #444;
        }
        footer a { color: #00aaff; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>TRENDING KEYWORDS</h1>
            <p class="date">${date}</p>
        </header>
        <main>
            <div class="trends-list">
${trendsHTML}
            </div>
            <div class="nav-links">
                <a href="./">← ARCHIVE</a>
                <a href="../">← HOME</a>
            </div>
        </main>
        <footer>
            Wiki + HN + Reddit | <a href="https://x.com/katsurakek">@katsurakek</a>
        </footer>
    </div>
</body>
</html>`;
}

// 索引页
function generateIndexHTML(files) {
  const listHTML = files
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 30)
    .map(f => `            <a href="./${f}" class="day-link">${f.replace('.html', '')}</a>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trending Keywords Archive</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Press Start 2P', cursive;
            min-height: 100vh;
            background: #0a0a0f;
            color: #e0e0e0;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 30px 16px;
        }
        .container { text-align: center; max-width: 400px; width: 100%; }
        h1 { font-size: 0.7rem; color: #00ff88; margin-bottom: 20px; }
        .days { display: flex; flex-direction: column; gap: 6px; }
        .day-link {
            display: block;
            padding: 10px 14px;
            background: #14141c;
            border: 1px solid #1e1e2a;
            border-radius: 4px;
            color: #e0e0e0;
            text-decoration: none;
            font-size: 0.5rem;
        }
        .day-link:hover { border-color: #00ff88; color: #00ff88; }
        .back-link {
            display: inline-block;
            margin-top: 20px;
            font-size: 0.4rem;
            color: #00aaff;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>ARCHIVE</h1>
        <div class="days">
${listHTML}
        </div>
        <a href="../" class="back-link">← HOME</a>
    </div>
</body>
</html>`;
}

async function main() {
  const today = getToday();
  const outputFile = path.join(CONFIG.outputDir, `${today}.html`);

  console.log(`📅 Fetching trends for ${today}...`);
  console.log('');

  const [wiki, hn] = await Promise.all([
    fetchWikipedia(),
    fetchHackerNews(),
  ]);

  // Reddit 单独跑，失败不影响整体
  let reddit = [];
  try {
    reddit = await fetchReddit();
  } catch (e) {
    console.log('⚠️ Reddit skipped');
  }

  const curated = getEmergingKeywords();

  let trends = mergeTrends([curated, wiki, hn, reddit]);

  console.log('');
  console.log(`✅ Total: ${trends.length} keywords`);

  if (trends.length < 5) {
    console.log('⚠️ Few trends, using curated only');
    trends = curated;
  }

  const html = generateHTML(trends, today);
  fs.writeFileSync(outputFile, html);
  console.log(`📄 Generated: ${outputFile}`);

  const files = fs.readdirSync(CONFIG.outputDir)
    .filter(f => f.endsWith('.html') && f !== 'index.html');
  fs.writeFileSync(CONFIG.indexFile, generateIndexHTML(files));
  console.log(`📄 Updated index`);

  console.log('🎉 Done!');
}

main();
