#!/usr/bin/env node

/**
 * 趋势词日报生成器
 * 从 Google Trends RSS 抓取热词，生成每日页面
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  // Google Trends RSS (美国)
  trendsUrl: 'https://trends.google.com/trending/rss?geo=US',
  // 输出目录
  outputDir: path.join(__dirname, '..', 'trends'),
  // 索引文件
  indexFile: path.join(__dirname, '..', 'trends', 'index.html'),
};

// 获取今日日期
function getToday() {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

// 从 RSS 解析趋势词
function parseTrends(xml) {
  const trends = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>/;
  const trafficRegex = /<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/;
  const linkRegex = /<link>(.*?)<\/link>/;
  const newsRegex = /<ht:news_item_title><!\[CDATA\[(.*?)\]\]><\/ht:news_item_title>/;

  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = item.match(titleRegex)?.[1] || '';
    const traffic = item.match(trafficRegex)?.[1] || '';
    const link = item.match(linkRegex)?.[1] || '';
    const newsTitle = item.match(newsRegex)?.[1] || '';

    if (title) {
      trends.push({
        keyword: title,
        traffic: traffic,
        link: link,
        news: newsTitle,
      });
    }
  }
  return trends;
}

// 生成页面标题
function generateTitle(trends, date) {
  const top3 = trends.slice(0, 3).map(t => t.keyword);
  return `${top3.join(' | ')} - Trending ${date}`;
}

// 生成 HTML 页面
function generateHTML(trends, date) {
  const title = generateTitle(trends, date);
  const trendsHTML = trends.map((t, i) => `
            <div class="trend-item">
                <span class="rank">#${i + 1}</span>
                <div class="trend-content">
                    <a href="${t.link}" target="_blank" class="keyword">${t.keyword}</a>
                    <span class="traffic">${t.traffic}</span>
                    ${t.news ? `<p class="news">${t.news}</p>` : ''}
                </div>
            </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <meta name="description" content="Daily trending topics: ${trends.slice(0, 5).map(t => t.keyword).join(', ')}">
    <meta name="keywords" content="${trends.map(t => t.keyword).join(', ')}">
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
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
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
        .trends-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .trend-item {
            display: flex;
            align-items: flex-start;
            gap: 15px;
            padding: 16px 20px;
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
            font-size: 0.7rem;
            color: #f4b41a;
            min-width: 40px;
        }
        .trend-content {
            flex: 1;
        }
        .keyword {
            font-size: 1.1rem;
            font-weight: 600;
            color: #f4f4f4;
            text-decoration: none;
        }
        .keyword:hover {
            color: #5fcde4;
        }
        .traffic {
            font-size: 0.8rem;
            color: #8b8b8b;
            margin-left: 10px;
        }
        .news {
            font-size: 0.85rem;
            color: #a0a0a0;
            margin-top: 6px;
            line-height: 1.4;
        }
        .back-link {
            display: inline-block;
            margin-top: 30px;
            font-family: 'Press Start 2P', cursive;
            font-size: 0.6rem;
            color: #5fcde4;
            text-decoration: none;
        }
        .back-link:hover { color: #8fe4f4; }
        footer {
            text-align: center;
            margin-top: 40px;
            padding: 20px;
            font-size: 0.75rem;
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
            <a href="../" class="back-link">← BACK HOME</a>
        </main>
        <footer>
            Data from Google Trends | <a href="https://x.com/katsurakek">@katsurakek</a>
        </footer>
    </div>
</body>
</html>`;
}

// 生成索引页面
function generateIndexHTML(files) {
  const listHTML = files
    .sort((a, b) => b.localeCompare(a)) // 倒序，最新在前
    .map(f => {
      const date = f.replace('.html', '');
      return `            <a href="./${f}" class="day-link">${date}</a>`;
    })
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
        .container {
            text-align: center;
            max-width: 600px;
        }
        h1 {
            font-size: 1rem;
            color: #5fcde4;
            margin-bottom: 30px;
        }
        .days {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .day-link {
            display: block;
            padding: 16px 24px;
            background: #2a2d42;
            border: 3px solid #5a5d7a;
            color: #f4f4f4;
            text-decoration: none;
            font-size: 0.65rem;
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
        <a href="../" class="back-link">← BACK HOME</a>
    </div>
</body>
</html>`;
}

// HTTP GET 请求
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// 主函数
async function main() {
  const today = getToday();
  const outputFile = path.join(CONFIG.outputDir, `${today}.html`);

  console.log(`📅 Generating trends for ${today}...`);

  try {
    // 抓取趋势
    console.log('📡 Fetching Google Trends RSS...');
    const xml = await fetchURL(CONFIG.trendsUrl);
    const trends = parseTrends(xml);

    if (trends.length === 0) {
      console.log('⚠️  No trends found, using fallback');
      // 使用备用数据
      trends.push(
        { keyword: 'AI', traffic: '500K+', link: '#', news: '' },
        { keyword: 'Technology', traffic: '200K+', link: '#', news: '' }
      );
    }

    console.log(`✅ Found ${trends.length} trending topics`);

    // 生成页面
    const html = generateHTML(trends, today);
    fs.writeFileSync(outputFile, html);
    console.log(`📄 Generated: ${outputFile}`);

    // 更新索引
    const files = fs.readdirSync(CONFIG.outputDir)
      .filter(f => f.endsWith('.html') && f !== 'index.html');
    const indexHTML = generateIndexHTML(files);
    fs.writeFileSync(CONFIG.indexFile, indexHTML);
    console.log(`📄 Updated index: ${CONFIG.indexFile}`);

    console.log('🎉 Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
