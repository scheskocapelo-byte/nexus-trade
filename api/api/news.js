const fetch = require('node-fetch');

const RSS_FEEDS = {
  btc: [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss'
  ],
  xau: [
    'https://www.fxstreet.com/rss/news',
    'https://feeds.reuters.com/reuters/businessNews'
  ]
};

async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NexusTrade/1.0' },
      timeout: 5000
    });
    const text = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(text)) !== null && items.length < 5) {
      const content = match[1];
      const title   = (content.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || content.match(/<title>(.*?)<\/title>/) || [])[1] || '';
      const link    = (content.match(/<link>(.*?)<\/link>/) || [])[1] || '';
      const pubDate = (content.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
      if (title) items.push({ title: title.trim(), link: link.trim(), pubDate: pubDate.trim() });
    }
    return items;
  } catch {
    return [];
  }
}

function timeAgo(dateStr) {
  if (!dateStr) return 'RÃ©cemment';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 60000;
  if (diff < 60) return `Il y a ${Math.round(diff)} min`;
  if (diff < 1440) return `Il y a ${Math.round(diff / 60)}h`;
  return `Il y a ${Math.round(diff / 1440)}j`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const [btcItems1, btcItems2, xauItems1, xauItems2] = await Promise.all([
      fetchRSS(RSS_FEEDS.btc[0]),
      fetchRSS(RSS_FEEDS.btc[1]),
      fetchRSS(RSS_FEEDS.xau[0]),
      fetchRSS(RSS_FEEDS.xau[1])
    ]);

    const btcNews = [...btcItems1, ...btcItems2].slice(0, 6).map(item => ({
      ...item,
      timeAgo: timeAgo(item.pubDate),
      source: item.link.includes('coindesk') ? 'CoinDesk' : 'CoinTelegraph',
      tag: 'BTC'
    }));

    const xauNews = [...xauItems1, ...xauItems2].slice(0, 6).map(item => ({
      ...item,
      timeAgo: timeAgo(item.pubDate),
      source: item.link.includes('fxstreet') ? 'FXStreet' : 'Reuters',
      tag: 'XAU'
    }));

    res.json({ success: true, btc: btcNews, xau: xauNews, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
