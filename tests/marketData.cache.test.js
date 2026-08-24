describe('marketData Redis caching', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.FINNHUB_API_KEY = 'test-finnhub-key';
    process.env.MARKET_DATA_ENABLE_YAHOO_FALLBACK = 'false';
    process.env.FINNHUB_QUOTE_CONCURRENCY = '2';
  });

  function loadMarketData(redisOverrides = {}) {
    jest.doMock('../services/redisCache', () => ({
      buildCacheKey: jest.fn((namespace, key) => `aivestor:${namespace}:${key}`),
      getJson: jest.fn(),
      isEnabled: jest.fn(() => true),
      setJson: jest.fn(),
      ...redisOverrides,
    }));
    jest.doMock('axios', () => ({
      get: jest.fn(),
      post: jest.fn(),
    }));

    const axios = require('axios');
    const redisCache = require('../services/redisCache');
    const marketData = require('../services/marketData');
    return { axios, marketData, redisCache };
  }

  test('returns a fresh Redis hit without calling the market provider', async () => {
    const cachedEntry = {
      time: Date.now(),
      data: {
        asOf: new Date().toISOString(),
        source: 'finnhub',
        quotes: [{
          symbol: 'AAPL',
          ticker: 'AAPL',
          name: 'Apple',
          type: 'equity',
          price: 200,
          previousClose: 195,
          change: 5,
          changePercent: 2.5641,
          currency: 'USD',
          source: 'finnhub',
          timestamp: new Date().toISOString(),
        }],
        errors: [],
      },
    };
    const { axios, marketData, redisCache } = loadMarketData({
      getJson: jest.fn().mockResolvedValue(cachedEntry),
    });

    const result = await marketData.fetchMarketData(['AAPL']);

    expect(result.quotes[0].price).toBe(200);
    expect(result.cache).toEqual(expect.objectContaining({ status: 'hit', layer: 'redis' }));
    expect(redisCache.getJson).toHaveBeenCalledWith('aivestor:market:quotes:v1:AAPL');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('writes successful provider responses to Redis', async () => {
    const { axios, marketData, redisCache } = loadMarketData({
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(true),
    });
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: {
        c: 101,
        pc: 100,
        d: 1,
        dp: 1,
        t: 1710000000,
      },
    });

    const result = await marketData.fetchMarketData(['AAPL'], { force: true });

    expect(result.quotes[0]).toEqual(expect.objectContaining({ symbol: 'AAPL', price: 101 }));
    expect(redisCache.getJson).not.toHaveBeenCalled();
    expect(redisCache.setJson).toHaveBeenCalledWith(
      'aivestor:market:quotes:v1:AAPL',
      expect.objectContaining({ data: expect.objectContaining({ source: 'finnhub' }) }),
      300000
    );
  });

  test('bounds concurrent Finnhub quote requests for a cold market batch', async () => {
    const { axios, marketData } = loadMarketData({
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(true),
    });
    let active = 0;
    let peak = 0;
    axios.get.mockImplementation(async (_url, options) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return {
        status: 200,
        data: { c: 100, pc: 99, d: 1, dp: 1.0101, t: 1710000000, symbol: options.params.symbol },
      };
    });

    const result = await marketData.fetchMarketData(['AAPL', 'MSFT', 'NVDA', 'AMZN'], { force: true });

    expect(result.quotes).toHaveLength(4);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
