const https = require('https');
const axios = require('axios');
require('dotenv').config();

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
const inFlight = new Map();
const CACHE_TTL_MS = Number(process.env.MARKET_DATA_CACHE_TTL_MS || 30000);
const STALE_TTL_MS = Number(process.env.MARKET_DATA_STALE_TTL_MS || 300000);
const MARKET_DATA_TIMEOUT_MS = Number(process.env.MARKET_DATA_TIMEOUT_MS || 15000);
const MARKET_FETCH_MAX_MS = Number(process.env.MARKET_FETCH_MAX_MS || 25000);
const CHART_FALLBACK_SYMBOL_LIMIT = Number(process.env.MARKET_CHART_FALLBACK_SYMBOL_LIMIT || 8);
const YAHOO_RATE_LIMIT_REQUESTS = Number(process.env.YAHOO_RATE_LIMIT_REQUESTS || 2);
const YAHOO_RATE_LIMIT_WINDOW_MS = Number(process.env.YAHOO_RATE_LIMIT_WINDOW_MS || 5000);
const YAHOO_RATE_LIMIT_COOLDOWN_MS = Number(process.env.YAHOO_RATE_LIMIT_COOLDOWN_MS || 60000);
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';
const FINNHUB_WEBSOCKET_SECRET = process.env.FINNHUB_WEBSOCKET_SECRET || FINNHUB_API_KEY;
const FINNHUB_BASE_URL = process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1';
const FINNHUB_WS_URL = process.env.FINNHUB_WS_URL || 'wss://ws.finnhub.io';
const FINNHUB_RATE_LIMIT_REQUESTS = Number(process.env.FINNHUB_RATE_LIMIT_REQUESTS || 55);
const FINNHUB_RATE_LIMIT_WINDOW_MS = Number(process.env.FINNHUB_RATE_LIMIT_WINDOW_MS || 60000);
const FINNHUB_RATE_LIMIT_COOLDOWN_MS = Number(process.env.FINNHUB_RATE_LIMIT_COOLDOWN_MS || 60000);
const MARKET_DATA_ENABLE_YAHOO_FALLBACK = process.env.MARKET_DATA_ENABLE_YAHOO_FALLBACK === 'true';
const YAHOO_QUOTE_URL = process.env.YAHOO_QUOTE_URL || 'https://query1.finance.yahoo.com/v7/finance/quote';
const YAHOO_CHART_URL = process.env.YAHOO_CHART_URL || 'https://query1.finance.yahoo.com/v8/finance/chart';
const httpsAgent = new https.Agent({ keepAlive: true, family: 4 });
const yahooRequestTimestamps = [];
const finnhubRequestTimestamps = [];
let yahooCooldownUntil = 0;
let finnhubCooldownUntil = 0;

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

const FINNHUB_SYMBOL_MAP = {
  'BRK-B': 'BRK.B',
  '^GSPC': 'SPY',
  '^DJI': 'DIA',
  '^IXIC': 'QQQ',
  '^RUT': 'IWM',
  '^VIX': 'VXX',
  'GC=F': 'OANDA:XAU_USD',
  'SI=F': 'OANDA:XAG_USD',
  'CL=F': 'OANDA:BCO_USD',
  'BTC-USD': 'BINANCE:BTCUSDT',
  'ETH-USD': 'BINANCE:ETHUSDT',
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

  if (!options.force && inFlight.has(key)) {
    return inFlight.get(key);
  }

  const request = loadMarketData(normalized, key, cached);
  if (!options.force) inFlight.set(key, request);

  try {
    return await request;
  } finally {
    if (!options.force) inFlight.delete(key);
  }
}

async function loadMarketData(normalized, key, cached) {
  try {
    const payload = await withTimeout(
      fetchProviderQuotes(normalized),
      MARKET_FETCH_MAX_MS,
      `Market data fetch exceeded ${MARKET_FETCH_MAX_MS}ms`
    );
    if (!payload.quotes || payload.quotes.length === 0) {
      const details = payload.errors?.map((entry) => `${entry.symbol || 'market'}: ${entry.error}`).join('; ');
      throw new Error(details || 'No market quotes returned');
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

async function fetchProviderQuotes(symbols) {
  if (!FINNHUB_API_KEY) {
    return fetchYahooQuotes(symbols);
  }

  const finnhubPayload = await fetchFinnhubQuotes(symbols).catch((error) => ({
    asOf: new Date().toISOString(),
    source: 'finnhub',
    quotes: [],
    errors: symbols.map((symbol) => ({ symbol, error: error.message })),
    providerError: error,
  }));

  const returned = new Set((finnhubPayload.quotes || []).map((quote) => quote.symbol));
  const missing = symbols.filter((symbol) => !returned.has(symbol));
  let yahooPayload = { quotes: [], errors: [] };

  if (missing.length && MARKET_DATA_ENABLE_YAHOO_FALLBACK) {
    try {
      yahooPayload = await fetchYahooQuotes(missing);
    } catch (error) {
      yahooPayload = {
        quotes: [],
        errors: missing.map((symbol) => ({ symbol, error: error.message })),
      };
    }
  }

  const quotes = [...(finnhubPayload.quotes || []), ...(yahooPayload.quotes || [])];
  const fallbackErrors = MARKET_DATA_ENABLE_YAHOO_FALLBACK
    ? yahooPayload.errors || []
    : missing.map((symbol) => ({ symbol, error: 'Not returned by Finnhub; Yahoo fallback disabled' }));
  const errors = [...(finnhubPayload.errors || []), ...fallbackErrors];
  if (!quotes.length && finnhubPayload.providerError) {
    throw finnhubPayload.providerError;
  }

  return {
    asOf: new Date().toISOString(),
    source: yahooPayload.quotes?.length ? 'finnhub+yahoo-finance' : 'finnhub',
    quotes: symbols.map((symbol) => quotes.find((quote) => quote.symbol === symbol)).filter(Boolean),
    errors,
  };
}

async function fetchFinnhubQuotes(symbols) {
  const quotes = [];
  const errors = [];

  for (const symbol of symbols) {
    try {
      const quote = await fetchFinnhubQuote(symbol);
      if (quote) {
        quotes.push(quote);
      } else {
        errors.push({ symbol, error: 'No Finnhub quote returned' });
      }
    } catch (error) {
      errors.push({ symbol, error: error.message || 'Finnhub quote failed' });
    }
  }

  if (!quotes.length && errors.length) {
    throw new Error(errors.map((entry) => `${entry.symbol}: ${entry.error}`).join('; '));
  }

  return {
    asOf: new Date().toISOString(),
    source: 'finnhub',
    quotes,
    errors,
  };
}

async function fetchFinnhubQuote(symbol) {
  const finnhubSymbol = toFinnhubSymbol(symbol);
  const response = await runFinnhubRequest(() => axios.get(`${FINNHUB_BASE_URL}/quote`, {
    params: { symbol: finnhubSymbol },
    timeout: MARKET_DATA_TIMEOUT_MS,
    httpsAgent,
    headers: {
      Accept: 'application/json',
      'X-Finnhub-Token': FINNHUB_API_KEY,
      'User-Agent': 'Aivestor/1.0 (+https://aivestor.local)',
    },
    validateStatus: (status) => status >= 200 && status < 500,
  }));

  if (response.status === 429) {
    setFinnhubCooldown();
    throw new Error('Finnhub rate limit reached. Try again shortly.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Finnhub authentication failed with status ${response.status}`);
  }
  if (response.status >= 400) {
    throw new Error(`Finnhub quote request failed with status ${response.status}`);
  }

  return normalizeFinnhubQuote(response.data, symbol, finnhubSymbol);
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
    setYahooCooldown();
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
  const quotes = [];
  const errors = [];
  const fallbackSymbols = symbols.slice(0, CHART_FALLBACK_SYMBOL_LIMIT);

  for (const symbol of fallbackSymbols) {
    try {
      const quote = await fetchYahooChartQuote(symbol);
      if (quote) {
        quotes.push(quote);
      } else {
        errors.push({ symbol, error: 'No chart quote returned' });
      }
    } catch (err) {
      errors.push({ symbol, error: err.message || 'No chart quote returned' });
    }
  }

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
    setYahooCooldown();
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
  if (Date.now() < yahooCooldownUntil) {
    const retryMs = yahooCooldownUntil - Date.now();
    throw new Error(`Yahoo Finance rate limit cooldown active. Retry in ${Math.ceil(retryMs / 1000)}s.`);
  }
  await waitForYahooSlot();
  return operation();
}

function setYahooCooldown() {
  yahooCooldownUntil = Math.max(yahooCooldownUntil, Date.now() + YAHOO_RATE_LIMIT_COOLDOWN_MS);
}

async function runFinnhubRequest(operation) {
  if (Date.now() < finnhubCooldownUntil) {
    const retryMs = finnhubCooldownUntil - Date.now();
    throw new Error(`Finnhub rate limit cooldown active. Retry in ${Math.ceil(retryMs / 1000)}s.`);
  }
  await waitForProviderSlot(finnhubRequestTimestamps, FINNHUB_RATE_LIMIT_REQUESTS, FINNHUB_RATE_LIMIT_WINDOW_MS);
  return operation();
}

function setFinnhubCooldown() {
  finnhubCooldownUntil = Math.max(finnhubCooldownUntil, Date.now() + FINNHUB_RATE_LIMIT_COOLDOWN_MS);
}

async function waitForYahooSlot() {
  return waitForProviderSlot(yahooRequestTimestamps, YAHOO_RATE_LIMIT_REQUESTS, YAHOO_RATE_LIMIT_WINDOW_MS);
}

async function waitForProviderSlot(timestamps, limit, windowMs) {
  while (true) {
    const now = Date.now();
    while (timestamps.length && now - timestamps[0] >= windowMs) {
      timestamps.shift();
    }

    if (timestamps.length < limit) {
      timestamps.push(now);
      return;
    }

    const waitMs = Math.max(25, windowMs - (now - timestamps[0]));
    await delay(waitMs);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
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

function normalizeFinnhubQuote(quote, requestedSymbol, providerSymbol) {
  const price = finiteNumber(quote?.c);
  const previousClose = finiteNumber(quote?.pc);
  if (price == null && previousClose == null) return null;

  const change = finiteNumber(quote?.d) ?? (
    price != null && previousClose != null ? price - previousClose : 0
  );
  const changePercent = finiteNumber(quote?.dp) ?? (
    previousClose ? (change / previousClose) * 100 : 0
  );
  const timestamp = Number.isFinite(Number(quote?.t)) && Number(quote.t) > 0
    ? new Date(Number(quote.t) * 1000).toISOString()
    : new Date().toISOString();

  return {
    symbol: requestedSymbol,
    ticker: requestedSymbol,
    providerSymbol,
    name: DISPLAY_NAMES[requestedSymbol] || requestedSymbol,
    type: normalizeQuoteType('', requestedSymbol),
    price: round(price ?? previousClose),
    previousClose: round(previousClose ?? price),
    change: round(change ?? 0),
    changePercent: round(changePercent ?? 0, 4),
    currency: requestedSymbol.endsWith('-USD') || requestedSymbol.endsWith('=F') ? 'USD' : 'USD',
    source: 'finnhub',
    timestamp,
  };
}

function normalizeFinnhubTrade(trade, symbolByProvider = new Map()) {
  const providerSymbol = String(trade?.s || '').toUpperCase();
  const symbol = symbolByProvider.get(providerSymbol) || fromFinnhubSymbol(providerSymbol);
  const price = finiteNumber(trade?.p);
  if (!symbol || price == null) return null;
  const timestampMs = Number(trade?.t);
  return {
    ticker: symbol,
    symbol,
    providerSymbol,
    name: DISPLAY_NAMES[symbol] || symbol,
    price: round(price),
    change: 0,
    changePercent: 0,
    currency: 'USD',
    source: 'finnhub-websocket',
    timestamp: Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : new Date().toISOString(),
  };
}

function toFinnhubSymbol(symbol) {
  return FINNHUB_SYMBOL_MAP[symbol] || symbol;
}

function fromFinnhubSymbol(providerSymbol) {
  const entry = Object.entries(FINNHUB_SYMBOL_MAP).find(([, value]) => value === providerSymbol);
  return entry?.[0] || providerSymbol;
}

function getFinnhubWebSocketConfig(symbols = DEFAULT_STREAM_SYMBOLS) {
  if (!FINNHUB_WEBSOCKET_SECRET) return null;
  const providerSymbols = normalizeSymbols(symbols)
    .map((symbol) => ({ symbol, providerSymbol: toFinnhubSymbol(symbol) }))
    .filter(({ providerSymbol }) => providerSymbol && !providerSymbol.startsWith('OANDA:'));
  return {
    url: `${FINNHUB_WS_URL}?token=${encodeURIComponent(FINNHUB_WEBSOCKET_SECRET)}`,
    symbols: providerSymbols,
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
  getFinnhubWebSocketConfig,
  normalizeFinnhubTrade,
  normalizeSymbols,
};
