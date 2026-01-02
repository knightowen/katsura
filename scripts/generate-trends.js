#!/usr/bin/env node

/**
 * 爆发新词发现器
 * 抓取 Google Trends Rising Queries - 寻找 SEO 抢占机会
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

function fetchURL(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        ...options.headers
      }
    };

    https.get(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ data, status: res.statusCode }));
    }).on('error', reject);
  });
}

// 从 Google Trends Daily Trends 提取上升词
async function fetchGoogleDailyTrends() {
  const trends = [];
  try {
    // Google Trends Daily API (非官方但稳定)
    const url = 'https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=-480&geo=US&ns=15';
    const { data } = await fetchURL(url);

    // 移除前缀 ")]}'\n"
    const jsonStr = data.substring(data.indexOf('{'));
    const json = JSON.parse(jsonStr);

    const days = json.default?.trendingSearchesDays || [];
    for (const day of days.slice(0, 2)) {
      for (const search of day.trendingSearches || []) {
        const title = search.title?.query;
        const traffic = search.formattedTraffic || '';
        const articles = search.articles || [];
        const relatedQueries = search.relatedQueries || [];

        if (title) {
          trends.push({
            keyword: title,
            traffic: traffic,
            source: 'Google',
            type: 'daily',
            related: relatedQueries.map(q => q.query).slice(0, 3),
            news: articles[0]?.title || '',
            newsUrl: articles[0]?.url || '',
          });
        }
      }
    }
    console.log(`📊 Google Daily Trends: ${trends.length} items`);
  } catch (e) {
    console.log('⚠️ Google Daily Trends failed:', e.message);
  }
  return trends;
}

// 从 Google Trends Realtime 提取实时上升词
async function fetchGoogleRealtime() {
  const trends = [];
  try {
    const url = 'https://trends.google.com/trends/api/realtimetrends?hl=en-US&tz=-480&cat=all&fi=0&fs=0&geo=US&ri=300&rs=20&sort=0';
    const { data } = await fetchURL(url);

    const jsonStr = data.substring(data.indexOf('{'));
    const json = JSON.parse(jsonStr);

    const stories = json.storySummaries?.trendingStories || [];
    for (const story of stories.slice(0, 15)) {
      const title = story.title || story.entityNames?.[0];
      if (title) {
        trends.push({
          keyword: title,
          traffic: 'Realtime',
          source: 'Google',
          type: 'realtime',
          related: story.entityNames?.slice(1, 4) || [],
        });
      }
    }
    console.log(`⚡ Google Realtime: ${trends.length} items`);
  } catch (e) {
    console.log('⚠️ Google Realtime failed:', e.message);
  }
  return trends;
}

// 从 Exploding Topics RSS 提取新兴话题 (他们有免费 RSS)
async function fetchExplodingTopics() {
  const trends = [];
  try {
    const url = 'https://explodingtopics.com/blog/feed';
    const { data } = await fetchURL(url);

    // 解析 RSS 中的新话题
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/;

    let match;
    while ((match = itemRegex.exec(data)) !== null && trends.length < 10) {
      const titleMatch = match[1].match(titleRegex);
      const title = titleMatch?.[1] || titleMatch?.[2];
      if (title && !title.includes('Exploding Topics')) {
        // 提取文章标题中的关键词
        const keywords = title.match(/[""]([^""]+)[""]|: ([^–-]+)/);
        if (keywords) {
          trends.push({
            keyword: (keywords[1] || keywords[2]).trim(),
            traffic: 'Rising',
            source: 'ExplodingTopics',
            type: 'emerging',
          });
        }
      }
    }
    console.log(`🚀 Exploding Topics: ${trends.length} items`);
  } catch (e) {
    console.log('⚠️ Exploding Topics failed:', e.message);
  }
  return trends;
}

// 合并去重
function mergeTrends(sources) {
  const seen = new Set();
  const all = [];

  for (const trends of sources) {
    for (const t of trends) {
      const key = t.keyword.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seen.has(key) && key.length > 2) {
        seen.add(key);
        all.push(t);
      }
    }
  }
  return all;
}

// 评估 SEO 机会分数
function scoreTrend(trend) {
  let score = 50;

  // Realtime = 新，加分
  if (trend.type === 'realtime') score += 20;
  if (trend.type === 'emerging') score += 30;

  // 有流量数据的加分
  if (trend.traffic && trend.traffic !== 'Realtime') {
    const num = parseInt(trend.traffic.replace(/[^0-9]/g, ''));
    if (num > 100) score += 10;
    if (num > 500) score += 10;
  }

  // 关键词长度适中加分 (2-4 个词最适合做站)
  const words = trend.keyword.split(/\s+/).length;
  if (words >= 2 && words <= 4) score += 15;

  return Math.min(100, score);
}

// 生成 HTML
function generateHTML(trends, date) {
  // 按分数排序
  trends.forEach(t => t.score = scoreTrend(t));
  trends.sort((a, b) => b.score - a.score);

  const title = `Rising Keywords ${date} | SEO Opportunities`;

  const typeColors = {
    'realtime': '#e74c3c',
    'daily': '#3498db',
    'emerging': '#2ecc71',
  };

  const typeLabels = {
    'realtime': '🔥 REALTIME',
    'daily': '📈 DAILY',
    'emerging': '🚀 EMERGING',
  };

  const trendsHTML = trends.slice(0, 30).map((t, i) => {
    const color = typeColors[t.type] || '#5fcde4';
    const label = typeLabels[t.type] || t.type;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(t.keyword)}`;
    const trendsUrl = `https://trends.google.com/trends/explore?q=${encodeURIComponent(t.keyword)}&geo=US`;

    return `
            <div class="trend-item" data-score="${t.score}">
                <div class="rank-score">
                    <span class="rank">#${i + 1}</span>
                    <span class="score">${t.score}</span>
                </div>
                <div class="trend-content">
                    <div class="keyword-row">
                        <span class="keyword">${t.keyword}</span>
                        <span class="type-badge" style="background:${color}">${label}</span>
                    </div>
                    <div class="meta">
                        ${t.traffic ? `<span class="traffic">${t.traffic}</span>` : ''}
                        ${t.related?.length ? `<span class="related">Related: ${t.related.join(', ')}</span>` : ''}
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
    <meta name="description" content="Daily rising keywords for SEO opportunities - ${date}">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@400;600;700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            min-height: 100vh;
            background: #0f1119;
            color: #f4f4f4;
            padding: 20px;
        }
        .container { max-width: 900px; margin: 0 auto; }
        header {
            text-align: center;
            padding: 40px 20px;
            margin-bottom: 30px;
            background: linear-gradient(135deg, #1a1d2e 0%, #2a2d42 100%);
            border: 2px solid #3a3d52;
            border-radius: 8px;
        }
        h1 {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.9rem;
            color: #2ecc71;
            margin-bottom: 10px;
            letter-spacing: 2px;
        }
        .subtitle {
            font-size: 0.8rem;
            color: #888;
            margin-bottom: 15px;
        }
        .date {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.6rem;
            color: #f4b41a;
        }
        .legend {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-top: 15px;
            font-size: 0.7rem;
        }
        .legend span { display: flex; align-items: center; gap: 5px; }
        .legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .trends-list { display: flex; flex-direction: column; gap: 12px; }
        .trend-item {
            display: flex;
            gap: 15px;
            padding: 16px;
            background: #1a1d2e;
            border: 1px solid #2a2d42;
            border-radius: 6px;
            transition: all 0.2s;
        }
        .trend-item:hover {
            border-color: #2ecc71;
            transform: translateX(4px);
        }
        .rank-score {
            display: flex;
            flex-direction: column;
            align-items: center;
            min-width: 50px;
        }
        .rank {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.55rem;
            color: #f4b41a;
        }
        .score {
            font-size: 1.2rem;
            font-weight: 700;
            color: #2ecc71;
            margin-top: 4px;
        }
        .trend-content { flex: 1; }
        .keyword-row {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .keyword {
            font-size: 1.1rem;
            font-weight: 600;
            color: #fff;
        }
        .type-badge {
            font-size: 0.6rem;
            padding: 3px 8px;
            border-radius: 4px;
            color: #fff;
            font-weight: 600;
        }
        .meta {
            margin-top: 8px;
            font-size: 0.8rem;
            color: #888;
        }
        .traffic {
            background: #2a2d42;
            padding: 2px 8px;
            border-radius: 3px;
            margin-right: 10px;
        }
        .related { color: #666; }
        .actions {
            margin-top: 10px;
            display: flex;
            gap: 10px;
        }
        .actions a {
            font-size: 0.75rem;
            color: #5fcde4;
            text-decoration: none;
            padding: 4px 10px;
            border: 1px solid #3a3d52;
            border-radius: 4px;
        }
        .actions a:hover {
            background: #2a2d42;
            border-color: #5fcde4;
        }
        .nav-links {
            margin-top: 30px;
            display: flex;
            gap: 20px;
        }
        .nav-links a {
            font-family: 'Press Start 2P', cursive;
            font-size: 0.5rem;
            color: #5fcde4;
            text-decoration: none;
        }
        .nav-links a:hover { color: #8fe4f4; }
        footer {
            text-align: center;
            margin-top: 40px;
            padding: 20px;
            font-size: 0.7rem;
            color: #555;
        }
        footer a { color: #5fcde4; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>RISING KEYWORDS</h1>
            <p class="subtitle">SEO Opportunity Scanner</p>
            <p class="date">${date}</p>
            <div class="legend">
                <span><span class="legend-dot" style="background:#e74c3c"></span> Realtime</span>
                <span><span class="legend-dot" style="background:#3498db"></span> Daily</span>
                <span><span class="legend-dot" style="background:#2ecc71"></span> Emerging</span>
            </div>
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
            Score = SEO opportunity (higher = better) | <a href="https://x.com/katsurakek">@katsurakek</a>
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
        .container { text-align: center; max-width: 600px; }
        h1 { font-size: 0.9rem; color: #2ecc71; margin-bottom: 30px; }
        .days { display: flex; flex-direction: column; gap: 10px; }
        .day-link {
            display: block;
            padding: 14px 20px;
            background: #1a1d2e;
            border: 2px solid #2a2d42;
            border-radius: 6px;
            color: #f4f4f4;
            text-decoration: none;
            font-size: 0.6rem;
            transition: all 0.2s;
        }
        .day-link:hover {
            border-color: #2ecc71;
            color: #2ecc71;
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
        <h1>RISING KEYWORDS ARCHIVE</h1>
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

  console.log(`📅 Scanning rising keywords for ${today}...`);

  // 并行抓取
  const [daily, realtime, exploding] = await Promise.all([
    fetchGoogleDailyTrends(),
    fetchGoogleRealtime(),
    fetchExplodingTopics(),
  ]);

  // 合并去重
  let trends = mergeTrends([realtime, daily, exploding]);

  console.log(`✅ Total: ${trends.length} unique rising keywords`);

  if (trends.length === 0) {
    console.log('❌ No trends found!');
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
