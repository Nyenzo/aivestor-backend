const express = require('express');
const { DEFAULT_MARKET_SYMBOLS, fetchMarketData, normalizeSymbols, searchMarketSymbols } = require('../services/marketData');
const { buildMarketModel, buildTradeSuggestions } = require('../services/marketModel');
const { getAiTradeSuggestions } = require('../services/aiMarketModel');

const router = express.Router();
const HTTP_MAX_AGE_SECONDS = Number(process.env.MARKET_HTTP_MAX_AGE_SECONDS || 15);
const HTTP_STALE_SECONDS = Number(process.env.MARKET_HTTP_STALE_SECONDS || 60);

function sendMarketData(res, data) {
  const cacheStatus = data.cache?.status || 'miss';
  res.set({
    'Cache-Control': `public, max-age=${HTTP_MAX_AGE_SECONDS}, stale-while-revalidate=${HTTP_STALE_SECONDS}`,
    'X-Data-Source': data.source || 'yahoo-finance',
    'X-Cache-Status': cacheStatus,
  });
  res.json(data);
}

router.get('/summary', async (_req, res) => {
  try {
    const data = await fetchMarketData(DEFAULT_MARKET_SYMBOLS);
    sendMarketData(res, data);
  } catch (err) {
    res.status(502).json({ error: 'Unable to fetch market data', detail: err.message });
  }
});

router.get('/quotes', async (req, res) => {
  try {
    const symbols = normalizeSymbols(req.query.symbols || req.query.tickers);
    const data = await fetchMarketData(symbols);
    sendMarketData(res, data);
  } catch (err) {
    res.status(502).json({ error: 'Unable to fetch market quotes', detail: err.message });
  }
});

router.get('/search', async (req, res) => {
  const query = String(req.query.q || req.query.query || '').trim();
  if (query.length < 2) return res.status(400).json({ error: 'Search query must contain at least two characters' });
  try {
    const results = await searchMarketSymbols(query);
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
    res.json({ query, source: 'finnhub', results });
  } catch (err) {
    res.status(502).json({ error: 'Market search is temporarily unavailable', detail: err.message });
  }
});

router.get('/insights', async (req, res) => {
  try {
    const symbols = normalizeSymbols(req.query.symbols || req.query.tickers || DEFAULT_MARKET_SYMBOLS);
    const data = await fetchMarketData(symbols);
    const riskLevel = req.query.riskLevel || req.query.risk_level || 'medium';
    let aiModel = null;
    try {
      aiModel = await getAiTradeSuggestions({ symbols, riskLevel, quotes: data.quotes });
    } catch (_error) {
      aiModel = null;
    }
    const model = buildMarketModel(data, { riskLevel, tradeSuggestions: aiModel?.suggestions });
    if (aiModel?.model) {
      model.model = { ...model.model, ai: { ...aiModel.model, cache: aiModel.cache } };
    }
    sendMarketData(res, { ...model, cache: data.cache });
  } catch (err) {
    res.status(502).json({ error: 'Unable to generate Aivestor market insights', detail: err.message });
  }
});

router.get('/trade-suggestions', async (req, res) => {
  try {
    const symbols = normalizeSymbols(req.query.symbols || req.query.tickers || DEFAULT_MARKET_SYMBOLS);
    const data = await fetchMarketData(symbols);
    const riskLevel = req.query.riskLevel || req.query.risk_level || 'medium';
    let aiModel = null;
    try {
      aiModel = await getAiTradeSuggestions({ symbols, riskLevel, quotes: data.quotes });
    } catch (_error) {
      aiModel = null;
    }
    const suggestions = aiModel?.suggestions || buildTradeSuggestions(data.quotes || [], riskLevel);
    sendMarketData(res, {
      asOf: data.asOf,
      source: data.source,
      model: aiModel?.model || { name: 'Aivestor Trade Suggestions', version: 'market-trend-js-v1' },
      suggestions,
      cache: data.cache,
    });
  } catch (err) {
    res.status(502).json({ error: 'Unable to generate trade suggestions', detail: err.message });
  }
});

module.exports = router;
