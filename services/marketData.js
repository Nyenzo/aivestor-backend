const https = require('https');
const axios = require('axios');

const DEFAULT_MARKET_SYMBOLS = [
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'GOOGL',
  'META',
  'TSLA',
  'JPM',
  'BRK-B',
  'SPY',
  'QQQ',
  '^GSPC',
  '^DJI',
  '^IXIC',
  '^RUT',
  '^VIX',
  'GC=F',
  'SI=F',
  'CL=F',
  'NG=F',
  'BTC-USD',
  'ETH-USD',
];

const DEFAULT_STREAM_SYMBOLS = [
  'AAPL',
  'MSFT',
  'NVDA',
  'TSLA',
  '^GSPC',
  '^DJI',
  '^IXIC',
  'GC=F',
  'CL=F',
  'BTC-USD',
];

const cache = new Map();
const CACHE_TTL_MS = Number(process.env.MARKET_DATA_CACHE_TTL_MS || 30000);
const STALE_TTL_MS = Number(process.env.MARKET_DATA_STALE_TTL_MS || 300000);
const MARKET_DATA_TIMEOUT_MS = Number(process.env.MARKET_DATA_TIMEOUT_MS || 15000);
const YAHOO_RATE_LIMIT_REQUESTS = Number(process.env.YAHOO_RATE_LIMIT_REQUESTS || 2);
const YAHOO_RATE_LIMIT_WINDOW_MS = Number(process.env.YAHOO_RATE_LIMIT_WINDOW_MS || 5000);
const YAHOO_QUOTE_URL = process.env.YAHOO_QUOTE_URL || 'https://query1.finance.yahoo.com/v7/finance/quote';
const YAHOO_CHART_URL = process.env.YAHOO_CHART_URL || 'https://query1.finance.yahoo.com/v8/finance/chart';
const httpsAgent = new https.Agent({ keepAlive: true, family: 4 });
const yahooRequestTimestamps = [];

const DISPLAY_NAMES = {
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
  AMZN: 'Amazon',
  GOOGL: 'Alphabet',
  META: 'Meta',
  TSLA: 'Tesla',
  JPM: 'JPMorgan Chase',
  'BRK-B': 'Berkshire Hathaway',
  SPY: 'S&P 500 ETF',
  QQQ: 'Nasdaq 100 ETF',
  '^GSPC': 'S&P 500',
  '^DJI': 'Dow Jones',
  '^IXIC': 'Nasdaq Composite',
  '^RUT': 'Russell 2000',
  '^VIX': 'VIX',
  'GC=F': 'Gold Futures',
  'SI=F': 'Silver Futures',
  'CL=F': 'Crude Oil Futures',
  'NG=F': 'Natural Gas Futures',
  'BTC-USD': 'Bitcoin',
  'ETH-USD': 'Ethereum',
};

function normalizeSymbols(symbols) {
  const input = Array.isArray(symbols) ? symbols : String(symbols || '').split(',');
  const seen = new Set();
  const normalized = [];

  input.forEach((item) => {
    const symbol = String(item || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    normalized.push(symbol);
  });

  return (normalized.length ? normalized : DEFAULT_MARKET_SYMBOLS).slice(0, 80);
}

function cacheKey(symbols) {
  return normalizeSymbols(symbols).join(',');
}

async function fetchMarketData(symbols = DEFAULT_MARKET_SYMBOLS, options = {}) {
  const normalized = normalizeSymbols(symbols);
  const key = cacheKey(normalized);
  const cached = cache.get(key);

  if (!options.force && cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return { ...cached.data, cache: { status: 'hit', ageMs: Date.now() - cached.time, ttlMs: CACHE_TTL_MS } };
  }

  try {
    const payload = await fetchYahooQuotes(normalized);
    if (!payload.quotes || payload.quotes.length === 0) {
      const details = payload.errors?.map((entry) => `${entry.symbol || 'market'}: ${entry.error}`).join('; ');
      throw new Error(details || 'No Yahoo Finance quotes returned');
    }

    const data = { ...payload, cache: { status: 'miss', ageMs: 0, ttlMs: CACHE_TTL_MS } };
    cache.set(key, { time: Date.now(), data: payload });
    return data;
  } catch (err) {
    if (cached && Date.now() - cached.time < STALE_TTL_MS) {
      return {
        ...cached.data,
        cache: {
          status: 'stale',
          ageMs: Date.now() - cached.time,
          ttlMs: CACHE_TTL_MS,
          staleTtlMs: STALE_TTL_MS,
          reason: err.message,
        },
      };
    }
    throw err;
  }
}

async function fetchYahooQuotes(symbols) {
  try {
    return await fetchYahooQuoteResponse(symbols);
  } catch (quoteError) {
    if (isRateLimitError(quoteError)) throw quoteError;
    try {
      return await fetchYahooChartResponse(symbols);
    } catch (chartError) {
      chartError.message = `${quoteError.message}; chart fallback failed: ${chartError.message}`;
      throw chartError;
    }
  }
}

async function fetchYahooQuoteResponse(symbols) {
  const response = await runYahooRequest(() => axios.get(YAHOO_QUOTE_URL, {
    params: {
      symbols: symbols.join(','),
    },
    timeout: MARKET_DATA_TIMEOUT_MS,
    httpsAgent,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 Aivestor/1.0 (+https://aivestor.local)',
    },
    validateStatus: (status) => status >= 200 && status < 500,
  }));

  if (response.status === 429) {
    throw new Error('Yahoo Finance rate limit reached. Try again shortly.');
  }
  if (response.status >= 400) {
    throw new Error(`Yahoo Finance request failed with status ${response.status}`);
  }

  const results = response.data?.quoteResponse?.result || [];
  const resultBySymbol = new Map(results.map((quote) => [String(quote.symbol || '').toUpperCase(), quote]));
  const quotes = [];
  const errors = [];

  symbols.forEach((symbol) => {
    const quote = resultBySymbol.get(symbol);
    if (!quote) {
      errors.push({ symbol, error: 'No quote returned' });
      return;
    }

    const normalized = normalizeQuote(quote, symbol);
    if (normalized) {
      quotes.push(normalized);
    } else {
      errors.push({ symbol, error: 'Quote did not include a market price' });
    }
  });

  return {
    asOf: new Date().toISOString(),
    source: 'yahoo-finance',
    quotes,
    errors,
  };
}

async function fetchYahooChartResponse(symbols) {
  const settled = await Promise.allSettled(symbols.map((symbol) => fetchYahooChartQuote(symbol)));
  const quotes = [];
  const errors = [];

  settled.forEach((result, index) => {
    const symbol = symbols[index];
    if (result.status === 'fulfilled' && result.value) {
      quotes.push(result.value);
    } else {
      errors.push({ symbol, error: result.reason?.message || 'No chart quote returned' });
    }
  });

  if (!quotes.length && errors.length) {
    throw new Error(errors.map((entry) => `${entry.symbol}: ${entry.error}`).join('; '));
  }

  return {
    asOf: new Date().toISOString(),
    source: 'yahoo-finance',
    quotes,
    errors,
  };
}

async function fetchYahooChartQuote(symbol) {
  const response = await runYahooRequest(() => axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}`, {
    params: { range: '2d', interval: '1d' },
    timeout: MARKET_DATA_TIMEOUT_MS,
    httpsAgent,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 Aivestor/1.0 (+https://aivestor.local)',
    },
    validateStatus: (status) => status >= 200 && status < 500,
  }));

  if (response.status === 429) {
    throw new Error('Yahoo Finance rate limit reached. Try again shortly.');
  }
  if (response.status >= 400) {
    throw new Error(`Yahoo Finance chart request failed with status ${response.status}`);
  }

  const result = response.data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const price = finiteNumber(meta.regularMarketPrice);
  const previousClose = finiteNumber(meta.chartPreviousClose) ?? finiteNumber(meta.previousClose);
  if (price == null && previousClose == null) return null;

  const change = price != null && previousClose != null ? price - previousClose : 0;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;
  const timestamp = Number.isFinite(meta.regularMarketTime)
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : new Date().toISOString();

  return {
    symbol,
    ticker: symbol,
    name: meta.shortName || meta.longName || DISPLAY_NAMES[symbol] || symbol,
    type: normalizeQuoteType(meta.instrumentType, symbol),
    price: round(price ?? previousClose),
    previousClose: round(previousClose ?? price),
    change: round(change),
    changePercent: round(changePercent, 4),
    currency: meta.currency || 'USD',
    source: 'yahoo-finance',
    timestamp,
  };
}

function isRateLimitError(error) {
  return /rate limit|status 429/i.test(error?.message || '');
}

async function runYahooRequest(operation) {
  await waitForYahooSlot();
  return operation();
}

async function waitForYahooSlot() {
  while (true) {
    const now = Date.now();
    while (yahooRequestTimestamps.length && now - yahooRequestTimestamps[0] >= YAHOO_RATE_LIMIT_WINDOW_MS) {
      yahooRequestTimestamps.shift();
    }

    if (yahooRequestTimestamps.length < YAHOO_RATE_LIMIT_REQUESTS) {
      yahooRequestTimestamps.push(now);
      return;
    }

    const waitMs = Math.max(25, YAHOO_RATE_LIMIT_WINDOW_MS - (now - yahooRequestTimestamps[0]));
    await delay(waitMs);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeQuote(quote, requestedSymbol) {
  const symbol = String(quote.symbol || requestedSymbol).toUpperCase();
  const price = finiteNumber(quote.regularMarketPrice);
  const previousClose = finiteNumber(quote.regularMarketPreviousClose);
  if (price == null && previousClose == null) return null;

  const change = finiteNumber(quote.regularMarketChange) ?? (
    price != null && previousClose != null ? price - previousClose : null
  );
  const changePercent = finiteNumber(quote.regularMarketChangePercent) ?? (
    change != null && previousClose ? (change / previousClose) * 100 : null
  );
  const timestamp = Number.isFinite(quote.regularMarketTime)
    ? new Date(quote.regularMarketTime * 1000).toISOString()
    : new Date().toISOString();

  return {
    symbol,
    ticker: symbol,
    name: quote.shortName || quote.longName || DISPLAY_NAMES[symbol] || symbol,
    type: normalizeQuoteType(quote.quoteType, symbol),
    price: round(price ?? previousClose),
    previousClose: round(previousClose ?? price),
    change: round(change ?? 0),
    changePercent: round(changePercent ?? 0, 4),
    currency: quote.currency || 'USD',
    source: 'yahoo-finance',
    timestamp,
  };
}

function normalizeQuoteType(quoteType, symbol) {
  const type = String(quoteType || '').toLowerCase();
  if (symbol.startsWith('^') || type.includes('index')) return 'index';
  if (symbol.endsWith('=F') || type.includes('future')) return 'commodity';
  if (symbol.endsWith('-USD') || type.includes('cryptocurrency')) return 'crypto';
  if (type.includes('etf')) return 'equity';
  return 'equity';
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(digits));
}

module.exports = {
  DEFAULT_MARKET_SYMBOLS,
  DEFAULT_STREAM_SYMBOLS,
  fetchMarketData,
  normalizeSymbols,
};
