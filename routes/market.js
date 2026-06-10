const express = require('express');
const { DEFAULT_MARKET_SYMBOLS, fetchMarketData, normalizeSymbols } = require('../services/marketData');
const { buildMarketModel, buildTradeSuggestions } = require('../services/marketModel');

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
    res.status(502).json({ error: 'Unable to fetch Yahoo Finance market data', detail: err.message });
  }
});

router.get('/quotes', async (req, res) => {
  try {
    const symbols = normalizeSymbols(req.query.symbols || req.query.tickers);
    const data = await fetchMarketData(symbols);
    sendMarketData(res, data);
  } catch (err) {
    res.status(502).json({ error: 'Unable to fetch Yahoo Finance quotes', detail: err.message });
  }
});

router.get('/insights', async (req, res) => {
  try {
    const symbols = normalizeSymbols(req.query.symbols || req.query.tickers || DEFAULT_MARKET_SYMBOLS);
    const data = await fetchMarketData(symbols);
    const model = buildMarketModel(data, { riskLevel: req.query.riskLevel || req.query.risk_level });
    sendMarketData(res, { ...model, cache: data.cache });
  } catch (err) {
    res.status(502).json({ error: 'Unable to generate Aivestor market insights', detail: err.message });
  }
});

router.get('/trade-suggestions', async (req, res) => {
  try {
    const symbols = normalizeSymbols(req.query.symbols || req.query.tickers || DEFAULT_MARKET_SYMBOLS);
    const data = await fetchMarketData(symbols);
    const suggestions = buildTradeSuggestions(data.quotes || [], req.query.riskLevel || req.query.risk_level || 'medium');
    sendMarketData(res, {
      asOf: data.asOf,
      source: data.source,
      model: { name: 'Aivestor Trade Suggestions', version: 'market-trend-js-v1' },
      suggestions,
      cache: data.cache,
    });
  } catch (err) {
    res.status(502).json({ error: 'Unable to generate trade suggestions', detail: err.message });
  }
});

module.exports = router;
