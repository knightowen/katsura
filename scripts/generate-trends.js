#!/usr/bin/env node

/**
 * 爆发新词发现器 v2
 * 使用稳定的公开数据源
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

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrendBot/2.0)' },
      timeout: 10000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// 1. Google Trends RSS (稳定)
async function fetchGoogleTrendsRSS() {
  const trends = [];
  try {
    const url = 'https://trends.google.com/trending/rss?geo=US';
    const data = await fetchURL(url);

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>([^<]+)<\/title>/;
    const trafficRegex = /<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/;
    const newsRegex = /<ht:news_item_title><!\[CDATA\[(.*?)\]\]><\/ht:news_item_title>/;

    let match;
    while ((match = itemRegex.exec(data)) !== null) {
      const item = match[1];
      const titleMatch = item.match(titleRegex);
      const title = titleMatch?.[1] || titleMatch?.[2];
      const traffic = item.match(trafficRegex)?.[1] || '';
      const news = item.match(newsRegex)?.[1] || '';

      if (title && title.trim()) {
        trends.push({
          keyword: title.trim(),
          traffic: traffic,
          source: 'Google',
          type: 'trending',
          news: news,
        });
      }
    }
    console.log(`📊 Google Trends RSS: ${trends.length} items`);
  } catch (e) {
    console.log(`⚠️ Google Trends RSS failed: ${e.message}`);
  }
  return trends;
}

// 2. Wikipedia 当日热门 (稳定)
async function fetchWikipediaTrending() {
  const trends = [];
  try {
    const today = new Date();
    const yesterday = new Date(today.setDate(today.getDate() - 1));
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day = String(yesterday.getDate()).padStart(2, '0');

    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${year}/${month}/${day}`;
    const data = await fetchURL(url);
    const json = JSON.parse(data);

    const articles = json.items?.[0]?.articles || [];
    // 过滤掉常见页面
    const skipList = ['Main_Page', 'Special:', 'Wikipedia:', 'Portal:', 'File:', 'Help:'];

    for (const article of articles.slice(0, 50)) {
      const title = article.article.replace(/_/g, ' ');
      if (!skipList.some(s => article.article.includes(s))) {
        trends.push({
          keyword: title,
          traffic: `${(article.views / 1000).toFixed(0)}K views`,
          source: 'Wikipedia',
          type: 'trending',
        });
      }
      if (trends.length >= 15) break;
    }
    console.log(`📚 Wikipedia Trending: ${trends.length} items`);
  } catch (e) {
    console.log(`⚠️ Wikipedia failed: ${e.message}`);
  }
  return trends;
}

// 3. GitHub Trending (技术类)
async function fetchGitHubTrending() {
  const trends = [];
  try {
    // 用 GitHub 非官方 trending API
    const url = 'https://api.gitterapp.com/repositories?since=daily';
    const data = await fetchURL(url);
    const repos = JSON.parse(data);

    for (const repo of repos.slice(0, 10)) {
      if (repo.name) {
        trends.push({
          keyword: repo.name,
          traffic: `★${repo.stars || 0}`,
          source: 'GitHub',
          type: 'tech',
          description: repo.description?.slice(0, 60) || '',
        });
      }
    }
    console.log(`💻 GitHub Trending: ${trends.length} items`);
  } catch (e) {
    console.log(`⚠️ GitHub Trending failed: ${e.message}`);
  }
  return trends;
}

// 4. Hacker News 热门 (技术类)
async function fetchHackerNews() {
  const trends = [];
  try {
    const idsData = await fetchURL('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = JSON.parse(idsData).slice(0, 8);

    for (const id of ids) {
      try {
        const itemData = await fetchURL(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        const item = JSON.parse(itemData);
        if (item?.title) {
          // 从标题提取关键词（不是整个标题）
          let keyword = item.title;
          // 如果标题包含冒号，取冒号前的部分
          if (keyword.includes(':')) {
            keyword = keyword.split(':')[0].trim();
          }
          // 如果太长，取前几个词
          if (keyword.split(' ').length > 5) {
            keyword = keyword.split(' ').slice(0, 4).join(' ');
          }

          trends.push({
            keyword: keyword,
            traffic: `${item.score} pts`,
            source: 'HN',
            type: 'tech',
            link: item.url,
          });
        }
      } catch (e) {}
    }
    console.log(`🔶 Hacker News: ${trends.length} items`);
  } catch (e) {
    console.log(`⚠️ HN failed: ${e.message}`);
  }
  return trends;
}

// 5. 获取新词（手动维护的热门新兴词，每次更新）
function getManualTrends() {
  // 这些是近期观察到的新兴词汇，可以定期手动更新
  return [
    { keyword: 'DeepSeek', traffic: 'Rising', source: 'Manual', type: 'emerging' },
    { keyword: 'Claude 3.5', traffic: 'Rising', source: 'Manual', type: 'emerging' },
    { keyword: 'Sora AI', traffic: 'Rising', source: 'Manual', type: 'emerging' },
    { keyword: 'Gemini 2.0', traffic: 'Rising', source: 'Manual', type: 'emerging' },
    { keyword: 'Apple Vision Pro', traffic: 'Rising', source: 'Manual', type: 'emerging' },
  ];
}

// 合并去重
function mergeTrends(sources) {
  const seen = new Set();
  const all = [];

  for (const trends of sources) {
    for (const t of trends) {
      const key = t.keyword.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
      if (!seen.has(key) && key.length > 2) {
        seen.add(key);
        all.push(t);
      }
    }
  }
  return all;
}

// 生成 HTML
function generateHTML(trends, date) {
  const title = `Rising Keywords ${date} | SEO Opportunities`;

  const typeColors = {
    'trending': '#3498db',
    'tech': '#9b59b6',
    'emerging': '#2ecc71',
  };

  const sourceColors = {
    'Google': '#4285f4',
    'Wikipedia': '#000',
    'GitHub': '#333',
    'HN': '#ff6600',
    'Manual': '#2ecc71',
  };

  const trendsHTML = trends.slice(0, 30).map((t, i) => {
    const color = sourceColors[t.source] || '#5fcde4';
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
                        ${t.news ? `<span class="news">${t.news.slice(0, 50)}...</span>` : ''}
                    </div>
                    <div class="actions">
                        <a href="${searchUrl}" target="_blank">Search</a>
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
    <meta name="description" content="Daily rising keywords - ${date}">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@400;600&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            min-height: 100vh;
            background: #0f1119;
            color: #f4f4f4;
            padding: 20px;
        }
        .container { max-width: 800px; margin: 0 auto; }
        header {
            text-align: center;
            padding: 30px 20px;
            margin-bottom: 25px;
            background: #1a1d2e;
            border: 2px solid #2a2d42;
            border-radius: 8px;
        }
        h1 {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.85rem;
            color: #2ecc71;
            margin-bottom: 10px;
        }
        .date {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.55rem;
            color: #f4b41a;
        }
        .trends-list { display: flex; flex-direction: column; gap: 10px; }
        .trend-item {
            display: flex;
            gap: 12px;
            padding: 14px;
            background: #1a1d2e;
            border: 1px solid #2a2d42;
            border-radius: 6px;
            transition: all 0.2s;
        }
        .trend-item:hover {
            border-color: #2ecc71;
            transform: translateX(3px);
        }
        .rank {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.5rem;
            color: #f4b41a;
            min-width: 32px;
            padding-top: 4px;
        }
        .trend-content { flex: 1; }
        .keyword-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .keyword { font-size: 1rem; font-weight: 600; color: #fff; }
        .source {
            font-size: 0.6rem;
            padding: 2px 6px;
            border-radius: 3px;
            color: #fff;
        }
        .meta { margin-top: 6px; font-size: 0.75rem; color: #888; }
        .traffic { background: #2a2d42; padding: 2px 6px; border-radius: 3px; }
        .news { margin-left: 8px; color: #666; }
        .actions { margin-top: 8px; display: flex; gap: 8px; }
        .actions a {
            font-size: 0.7rem;
            color: #5fcde4;
            text-decoration: none;
            padding: 3px 8px;
            border: 1px solid #3a3d52;
            border-radius: 3px;
        }
        .actions a:hover { background: #2a2d42; }
        .nav-links { margin-top: 25px; display: flex; gap: 15px; }
        .nav-links a {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.45rem;
            color: #5fcde4;
            text-decoration: none;
        }
        footer {
            text-align: center;
            margin-top: 30px;
            font-size: 0.65rem;
            color: #555;
        }
        footer a { color: #5fcde4; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>RISING KEYWORDS</h1>
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
            Sources: Google, Wikipedia, GitHub, HN | <a href="https://x.com/katsurakek">@katsurakek</a>
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
    <title>Rising Keywords Archive</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Press Start 2P', cursive;
            min-height: 100vh;
            background: #0f1119;
            color: #f4f4f4;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 40px 20px;
        }
        .container { text-align: center; max-width: 500px; }
        h1 { font-size: 0.8rem; color: #2ecc71; margin-bottom: 25px; }
        .days { display: flex; flex-direction: column; gap: 8px; }
        .day-link {
            display: block;
            padding: 12px 16px;
            background: #1a1d2e;
            border: 2px solid #2a2d42;
            border-radius: 5px;
            color: #f4f4f4;
            text-decoration: none;
            font-size: 0.55rem;
        }
        .day-link:hover { border-color: #2ecc71; color: #2ecc71; }
        .back-link {
            display: inline-block;
            margin-top: 25px;
            font-size: 0.45rem;
            color: #5fcde4;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>KEYWORDS ARCHIVE</h1>
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

  console.log(`📅 Scanning keywords for ${today}...`);

  // 并行抓取多个稳定数据源
  const [google, wiki, github, hn] = await Promise.all([
    fetchGoogleTrendsRSS(),
    fetchWikipediaTrending(),
    fetchGitHubTrending(),
    fetchHackerNews(),
  ]);

  // 手动维护的新兴词
  const manual = getManualTrends();

  // 合并
  let trends = mergeTrends([google, wiki, github, hn, manual]);

  console.log(`✅ Total: ${trends.length} keywords`);

  if (trends.length < 5) {
    console.log('⚠️ Too few trends, adding fallback...');
    trends = [...trends, ...manual];
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
