#!/usr/bin/env node

/**
 * 趋势词日报生成器
 * 多数据源抓取：Google Trends RSS + HackerNews + Reddit
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

// HTTP GET
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : require('http');
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 TrendBot/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// 1. Google Trends Daily (美国)
async function fetchGoogleTrends() {
  try {
    const xml = await fetchURL('https://trends.google.com/trending/rss?geo=US');
    const trends = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>/;
    const trafficRegex = /<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/;

    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const title = match[1].match(titleRegex)?.[1];
      const traffic = match[1].match(trafficRegex)?.[1] || '';
      if (title) trends.push({ keyword: title, traffic, source: 'Google' });
    }
    console.log(`📊 Google Trends: ${trends.length} items`);
    return trends;
  } catch (e) {
    console.log('⚠️ Google Trends failed:', e.message);
    return [];
  }
}

// 2. Hacker News Top Stories
async function fetchHackerNews() {
  try {
    const idsJson = await fetchURL('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = JSON.parse(idsJson).slice(0, 15);

    const trends = [];
    for (const id of ids.slice(0, 10)) {
      const itemJson = await fetchURL(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const item = JSON.parse(itemJson);
      if (item && item.title) {
        trends.push({
          keyword: item.title,
          traffic: `${item.score} pts`,
          source: 'HN',
          link: item.url || `https://news.ycombinator.com/item?id=${id}`
        });
      }
    }
    console.log(`🔶 Hacker News: ${trends.length} items`);
    return trends;
  } catch (e) {
    console.log('⚠️ HackerNews failed:', e.message);
    return [];
  }
}

// 3. Reddit Rising (r/technology + r/programming)
async function fetchReddit() {
  try {
    const trends = [];
    const subs = ['technology', 'programming', 'artificial'];

    for (const sub of subs) {
      try {
        const json = await fetchURL(`https://www.reddit.com/r/${sub}/rising.json?limit=5`);
        const data = JSON.parse(json);
        if (data?.data?.children) {
          for (const post of data.data.children.slice(0, 3)) {
            const p = post.data;
            trends.push({
              keyword: p.title.slice(0, 80) + (p.title.length > 80 ? '...' : ''),
              traffic: `${p.score} ups`,
              source: `r/${sub}`,
              link: `https://reddit.com${p.permalink}`
            });
          }
        }
      } catch (e) {}
    }
    console.log(`🔴 Reddit: ${trends.length} items`);
    return trends;
  } catch (e) {
    console.log('⚠️ Reddit failed:', e.message);
    return [];
  }
}

// 4. Product Hunt (今日热门)
async function fetchProductHunt() {
  try {
    // PH 没有公开 API，用网页抓取备选数据
    return []; // 跳过，需要 API key
  } catch (e) {
    return [];
  }
}

// 合并去重
function mergeTrends(sources) {
  const seen = new Set();
  const all = [];

  for (const trends of sources) {
    for (const t of trends) {
      const key = t.keyword.toLowerCase().slice(0, 30);
      if (!seen.has(key)) {
        seen.add(key);
        all.push(t);
      }
    }
  }
  return all;
}

// 生成标题
function generateTitle(trends, date) {
  const keywords = trends.slice(0, 3).map(t => {
    // 提取关键词（取前几个词）
    const words = t.keyword.split(/\s+/).slice(0, 3).join(' ');
    return words.length > 25 ? words.slice(0, 25) + '...' : words;
  });
  return `${keywords.join(' | ')} - ${date}`;
}

// 生成 HTML
function generateHTML(trends, date) {
  const title = generateTitle(trends, date);

  const sourceColors = {
    'Google': '#4285f4',
    'HN': '#ff6600',
    'r/technology': '#ff4500',
    'r/programming': '#ff4500',
    'r/artificial': '#ff4500',
  };

  const trendsHTML = trends.slice(0, 25).map((t, i) => {
    const color = sourceColors[t.source] || '#5fcde4';
    const link = t.link || `https://www.google.com/search?q=${encodeURIComponent(t.keyword)}`;
    return `
            <div class="trend-item">
                <span class="rank">#${i + 1}</span>
                <div class="trend-content">
                    <a href="${link}" target="_blank" class="keyword">${t.keyword}</a>
                    <span class="meta">
                        <span class="source" style="background:${color}">${t.source}</span>
                        <span class="traffic">${t.traffic}</span>
                    </span>
                </div>
            </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <meta name="description" content="Daily trending: ${trends.slice(0, 5).map(t => t.keyword.slice(0,30)).join(', ')}">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@400;600&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            min-height: 100vh;
            background: #1a1c2c;
            color: #f4f4f4;
            padding: 20px;
        }
        .container { max-width: 800px; margin: 0 auto; }
        header {
            text-align: center;
            padding: 40px 20px;
            margin-bottom: 30px;
            background: #2a2d42;
            border: 4px solid #5a5d7a;
        }
        h1 {
            font-family: 'Press Start 2P', cursive;
            font-size: 1rem;
            color: #5fcde4;
            margin-bottom: 10px;
        }
        .date {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.6rem;
            color: #f4b41a;
        }
        .trends-list { display: flex; flex-direction: column; gap: 10px; }
        .trend-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 14px 16px;
            background: #2a2d42;
            border: 2px solid #3a3d52;
            transition: all 0.2s;
        }
        .trend-item:hover {
            border-color: #5fcde4;
            transform: translateX(4px);
        }
        .rank {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.6rem;
            color: #f4b41a;
            min-width: 36px;
        }
        .trend-content { flex: 1; }
        .keyword {
            font-size: 1rem;
            font-weight: 600;
            color: #f4f4f4;
            text-decoration: none;
            line-height: 1.4;
            display: block;
        }
        .keyword:hover { color: #5fcde4; }
        .meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
        .source {
            font-size: 0.65rem;
            padding: 2px 6px;
            border-radius: 3px;
            color: #fff;
            font-weight: 600;
        }
        .traffic { font-size: 0.75rem; color: #888; }
        .back-link {
            display: inline-block;
            margin-top: 30px;
            font-family: 'Press Start 2P', cursive;
            font-size: 0.55rem;
            color: #5fcde4;
            text-decoration: none;
        }
        .back-link:hover { color: #8fe4f4; }
        footer {
            text-align: center;
            margin-top: 40px;
            padding: 20px;
            font-size: 0.7rem;
            color: #666;
        }
        footer a { color: #5fcde4; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>TRENDING NOW</h1>
            <p class="date">${date}</p>
        </header>
        <main>
            <div class="trends-list">
${trendsHTML}
            </div>
            <a href="./" class="back-link">← ARCHIVE</a>
            <a href="../" class="back-link" style="margin-left:20px">← HOME</a>
        </main>
        <footer>
            Sources: Google Trends, Hacker News, Reddit | <a href="https://x.com/katsurakek">@katsurakek</a>
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
    <title>Daily Trends Archive</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Press Start 2P', cursive;
            min-height: 100vh;
            background: #1a1c2c;
            color: #f4f4f4;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 40px 20px;
        }
        .container { text-align: center; max-width: 600px; }
        h1 { font-size: 1rem; color: #5fcde4; margin-bottom: 30px; }
        .days { display: flex; flex-direction: column; gap: 10px; }
        .day-link {
            display: block;
            padding: 14px 20px;
            background: #2a2d42;
            border: 3px solid #5a5d7a;
            color: #f4f4f4;
            text-decoration: none;
            font-size: 0.6rem;
            transition: all 0.1s;
        }
        .day-link:hover {
            border-color: #f4b41a;
            color: #f4b41a;
            transform: translateX(4px);
        }
        .back-link {
            display: inline-block;
            margin-top: 30px;
            font-size: 0.5rem;
            color: #5fcde4;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>TRENDS ARCHIVE</h1>
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

  console.log(`📅 Generating trends for ${today}...`);

  // 并行抓取多个数据源
  const [google, hn, reddit] = await Promise.all([
    fetchGoogleTrends(),
    fetchHackerNews(),
    fetchReddit(),
  ]);

  // 合并结果
  let trends = mergeTrends([google, hn, reddit]);

  console.log(`✅ Total: ${trends.length} unique items`);

  if (trends.length === 0) {
    console.log('❌ No trends found from any source!');
    process.exit(1);
  }

  // 生成页面
  const html = generateHTML(trends, today);
  fs.writeFileSync(outputFile, html);
  console.log(`📄 Generated: ${outputFile}`);

  // 更新索引
  const files = fs.readdirSync(CONFIG.outputDir)
    .filter(f => f.endsWith('.html') && f !== 'index.html');
  fs.writeFileSync(CONFIG.indexFile, generateIndexHTML(files));
  console.log(`📄 Updated index`);

  console.log('🎉 Done!');
}

main();
