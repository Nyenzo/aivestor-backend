const axios = require('axios');
const jwt = require('jsonwebtoken');
const redisCache = require('./redisCache');
const { config } = require('../config/env');

const memoryCache = new Map();
const inFlight = new Map();
const CACHE_TTL_MS = Number(process.env.AI_MARKET_MODEL_CACHE_TTL_MS || 300000);
const TIMEOUT_MS = Number(process.env.AI_MARKET_MODEL_TIMEOUT_MS || 12000);
const MAX_SYMBOLS = Number(process.env.AI_MARKET_MODEL_SYMBOL_LIMIT || 6);

function normalizeSymbols(symbols) {
  return Array.from(new Set((symbols || [])
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean)))
    .slice(0, MAX_SYMBOLS);
}

function buildCacheKey(symbols, riskLevel) {
  return `${String(riskLevel || 'medium').toLowerCase()}:${symbols.join(',')}`;
}

async function getAiTradeSuggestions({ symbols, riskLevel = 'medium', quotes = [] }) {
  const normalizedSymbols = normalizeSymbols(symbols);
  if (!normalizedSymbols.length) return null;

  const key = buildCacheKey(normalizedSymbols, riskLevel);
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry && Date.now() - memoryEntry.time < CACHE_TTL_MS) {
    return mergeLiveQuotes(memoryEntry.data, quotes, { status: 'hit', layer: 'memory' });
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const request = loadAiTradeSuggestions({ normalizedSymbols, riskLevel, quotes, key, memoryEntry });
  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

async function loadAiTradeSuggestions({ normalizedSymbols, riskLevel, quotes, key, memoryEntry }) {
  const distributedEntry = await getDistributedCache(key);
  if (distributedEntry && Date.now() - distributedEntry.time < CACHE_TTL_MS) {
    memoryCache.set(key, distributedEntry);
    return mergeLiveQuotes(distributedEntry.data, quotes, { status: 'hit', layer: 'redis' });
  }

  const token = jwt.sign({ service: 'backend', purpose: 'market-insights' }, config.jwtSecret, { expiresIn: '1h' });
  const response = await axios.post(
    `${config.aiServiceUrl}/trade_suggestions`,
    { tickers: normalizedSymbols, risk_tolerance: riskLevel },
    { headers: { Authorization: `Bearer ${token}` }, timeout: TIMEOUT_MS }
  );
  const data = normalizeAiResponse(response.data, normalizedSymbols, riskLevel);
  const entry = { time: Date.now(), data };
  memoryCache.set(key, entry);
  if (redisCache.isEnabled()) {
    await redisCache.setJson(redisCache.buildCacheKey('ai:trade-suggestions:v2', key), entry, CACHE_TTL_MS);
  }
  return mergeLiveQuotes(data, quotes, { status: 'miss' });
}

async function getDistributedCache(key) {
  if (!redisCache.isEnabled()) return null;
  const entry = await redisCache.getJson(redisCache.buildCacheKey('ai:trade-suggestions:v2', key));
  return entry && Number.isFinite(Number(entry.time)) && Array.isArray(entry.data?.suggestions) ? entry : null;
}

function normalizeAiResponse(response, symbols, riskLevel) {
  const suggestions = (response?.suggestions || [])
    .map((suggestion) => normalizeSuggestion(suggestion, riskLevel))
    .filter(Boolean);
  if (!suggestions.length) throw new Error('AI model returned no actionable suggestions');
  return {
    model: response?.model || { name: 'Aivestor AI Model', version: 'unknown' },
    suggestions,
    symbols,
  };
}

function normalizeSuggestion(suggestion, riskLevel) {
  const symbol = String(suggestion?.symbol || '').trim().toUpperCase();
  if (!symbol) return null;
  const confidence = Number(suggestion.confidence);
  return {
    symbol,
    name: suggestion.name || symbol,
    action: suggestion.action || 'Watch',
    confidence: Number.isFinite(confidence) ? confidence : null,
    price: finiteNumber(suggestion.price),
    stop: finiteNumber(suggestion.stop),
    target: finiteNumber(suggestion.target),
    rationale: String(suggestion.rationale || `${symbol} model output is available for ${riskLevel} risk.`),
  };
}

function mergeLiveQuotes(modelData, quotes, cache) {
  const quoteMap = new Map((quotes || []).map((quote) => [quote.symbol, quote]));
  return {
    ...modelData,
    suggestions: modelData.suggestions.map((suggestion) => {
      const quote = quoteMap.get(suggestion.symbol);
      return {
        ...suggestion,
        name: quote?.name || suggestion.name,
        price: finiteNumber(quote?.price) ?? suggestion.price,
        changePercent: finiteNumber(quote?.changePercent),
      };
    }),
    cache,
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = { getAiTradeSuggestions };
