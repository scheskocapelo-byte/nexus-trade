const fetch = require('node-fetch');

// â”€â”€ CONFIG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TWELVE_KEY  = process.env.TWELVE_DATA_KEY;
const ANTHROPIC   = process.env.ANTHROPIC_API_KEY;
const TG_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT     = process.env.TELEGRAM_CHAT_ID;

const SYMBOLS = {
  xau: { name: 'XAUUSD', display: 'ðŸ¥‡ Or (XAUUSD)',  interval: '15min', outputsize: 80 },
  btc: { name: 'BTC/USD', display: 'â‚¿ Bitcoin (BTC/USD)', interval: '15min', outputsize: 80 }
};

// â”€â”€ HELPERS TECHNIQUES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  return closes.reduce((emas, price, i) => {
    if (i === 0) return [price];
    emas.push(price * k + emas[i - 1] * (1 - k));
    return emas;
  }, []);
}

function calcRSI(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }
  const rs = avgGain / (avgLoss || 0.0001);
  return 100 - (100 / (1 + rs));
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = calcEMA(macdLine.slice(-9), 9);
  const histogram = macdLine[macdLine.length - 1] - signal[signal.length - 1];
  return {
    macd: macdLine[macdLine.length - 1],
    signal: signal[signal.length - 1],
    histogram,
    bullish: histogram > 0 && macdLine[macdLine.length - 1] > signal[signal.length - 1]
  };
}

function calcBollinger(closes, period = 20) {
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
  const price = closes[closes.length - 1];
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std, price, std };
}

function findSupportResistance(highs, lows, price) {
  const levels = [...highs.slice(-30), ...lows.slice(-30)].sort((a, b) => a - b);
  const clusters = [];
  let cluster = [levels[0]];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] < price * 0.002) cluster.push(levels[i]);
    else { clusters.push(cluster); cluster = [levels[i]]; }
  }
  clusters.push(cluster);
  const keyLevels = clusters
    .filter(c => c.length >= 2)
    .map(c => c.reduce((a, b) => a + b, 0) / c.length)
    .sort((a, b) => Math.abs(a - price) - Math.abs(b - price));
  const nearest = keyLevels[0];
  const proximity = nearest ? Math.abs(price - nearest) / price < 0.005 : false;
  return { nearLevel: nearest, proximity };
}

// â”€â”€ FETCH PRIX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchPrices(symbol, interval, outputsize) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.values) throw new Error(`Twelve Data erreur pour ${symbol}: ${JSON.stringify(data)}`);
  const values = data.values.reverse(); // chronologique
  return {
    closes: values.map(v => parseFloat(v.close)),
    highs:  values.map(v => parseFloat(v.high)),
    lows:   values.map(v => parseFloat(v.low)),
    opens:  values.map(v => parseFloat(v.open)),
    price:  parseFloat(values[values.length - 1].close)
  };
}

// â”€â”€ ANALYSE CLAUDE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function analyzeWithClaude(symbol, indicators) {
  const prompt = `Tu es un expert en trading forex et crypto. Analyse ce marchÃ© et retourne UNIQUEMENT un JSON valide, sans texte avant ou aprÃ¨s.

MarchÃ©: ${symbol}
Prix actuel: ${indicators.price}
EMA9: ${indicators.ema9.toFixed(5)}
EMA21: ${indicators.ema21.toFixed(5)}
EMA50: ${indicators.ema50.toFixed(5)}
RSI(14): ${indicators.rsi.toFixed(2)}
MACD: ${indicators.macd.macd.toFixed(5)} | Signal: ${indicators.macd.signal.toFixed(5)} | Histogramme: ${indicators.macd.histogram.toFixed(5)}
Bollinger Upper: ${indicators.bollinger.upper.toFixed(5)} | Middle: ${indicators.bollinger.middle.toFixed(5)} | Lower: ${indicators.bollinger.lower.toFixed(5)}
Niveau S/R proche: ${indicators.sr.nearLevel ? indicators.sr.nearLevel.toFixed(5) : 'aucun'} | ProximitÃ©: ${indicators.sr.proximity}

RÃ¨gles d'analyse:
- Score minimum pour signal valide: 6/10
- BUY si tendance haussiÃ¨re confirmÃ©e par plusieurs indicateurs
- SELL si tendance baissiÃ¨re confirmÃ©e par plusieurs indicateurs
- WAIT si pas de signal clair
- SL: distance raisonnable selon volatilitÃ© (ATR implicite)
- TP: ratio R/R minimum 1.5
- Score chaque stratÃ©gie de 0 Ã  10

RÃ©ponds UNIQUEMENT avec ce JSON:
{
  "direction": "BUY" ou "SELL" ou "WAIT",
  "score": 0-10,
  "entry": prix_entree,
  "sl": prix_stop_loss,
  "tp": prix_take_profit,
  "rr": ratio_risque_reward,
  "strategies": {
    "ema_crossover": {"vote": true/false, "score": 0-10, "reason": "explication courte"},
    "rsi_divergence": {"vote": true/false, "score": 0-10, "reason": "explication courte"},
    "macd_momentum": {"vote": true/false, "score": 0-10, "reason": "explication courte"},
    "trend_continuation": {"vote": true/false, "score": 0-10, "reason": "explication courte"},
    "bollinger_breakout": {"vote": true/false, "score": 0-10, "reason": "explication courte"},
    "support_resistance": {"vote": true/false, "score": 0-10, "reason": "explication courte"}
  },
  "analysis": "RÃ©sumÃ© en franÃ§ais en 2 phrases maximum"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  const text = data.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

// â”€â”€ TELEGRAM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function sendTelegram(message) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text: message,
      parse_mode: 'HTML'
    })
  });
}

// â”€â”€ HANDLER PRINCIPAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const asset = req.query.asset || 'xau';
  const sym = SYMBOLS[asset];
  if (!sym) return res.status(400).json({ error: 'Asset invalide. Utilisez xau ou btc.' });

  try {
    // 1. RÃ©cupÃ¨re les prix
    const { closes, highs, lows, price } = await fetchPrices(sym.name, sym.interval, sym.outputsize);

    // 2. Calcule les indicateurs
    const emas9  = calcEMA(closes, 9);
    const emas21 = calcEMA(closes, 21);
    const emas50 = calcEMA(closes, 50);
    const indicators = {
      price,
      ema9:      emas9[emas9.length - 1],
      ema21:     emas21[emas21.length - 1],
      ema50:     emas50[emas50.length - 1],
      rsi:       calcRSI(closes),
      macd:      calcMACD(closes),
      bollinger: calcBollinger(closes),
      sr:        findSupportResistance(highs, lows, price)
    };

    // 3. Analyse IA
    const signal = await analyzeWithClaude(sym.name, indicators);

    // 4. Telegram si signal fort
    if (signal.score >= 6 && signal.direction !== 'WAIT') {
      const emoji = signal.direction === 'BUY' ? 'ðŸŸ¢' : 'ðŸ”´';
      const msg = `${emoji} <b>NEXUSTRADE â€” SIGNAL ${signal.direction}</b>

ðŸ“Š <b>${sym.display}</b>
âš¡ EntrÃ©e : <b>${signal.entry}</b>
ðŸ›‘ Stop Loss : <b>${signal.sl}</b>
ðŸŽ¯ Take Profit : <b>${signal.tp}</b>
ðŸ“ˆ R/R : <b>1 : ${signal.rr}</b>
â­ Score : <b>${signal.score}/10</b>

ðŸ’¬ ${signal.analysis}

âš ï¸ Placez le trade manuellement sur MT4.`;
      await sendTelegram(msg);
    }

    // 5. Retourne tout au dashboard
    res.json({
      success: true,
      asset: sym.name,
      price,
      indicators: {
        ema9:      indicators.ema9,
        ema21:     indicators.ema21,
        ema50:     indicators.ema50,
        rsi:       indicators.rsi,
        macd:      indicators.macd,
        bollinger: indicators.bollinger
      },
      signal,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
