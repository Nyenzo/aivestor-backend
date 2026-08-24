describe('AI market model service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.AI_SERVICE_URL = 'http://localhost:5001';
    process.env.JWT_SECRET = 'test-secret';
  });

  function loadService(redisOverrides = {}) {
    jest.doMock('../services/redisCache', () => ({
      buildCacheKey: jest.fn((namespace, key) => `aivestor:${namespace}:${key}`),
      getJson: jest.fn().mockResolvedValue(null),
      isEnabled: jest.fn(() => true),
      setJson: jest.fn().mockResolvedValue(true),
      ...redisOverrides,
    }));
    jest.doMock('axios', () => ({ post: jest.fn() }));
    jest.doMock('jsonwebtoken', () => ({ sign: jest.fn(() => 'service-token') }));

    return {
      axios: require('axios'),
      jwt: require('jsonwebtoken'),
      redisCache: require('../services/redisCache'),
      service: require('../services/aiMarketModel'),
    };
  }

  test('calls the Flask service with a signed service token and overlays current quotes', async () => {
    const { axios, jwt, redisCache, service } = loadService();
    axios.post.mockResolvedValue({
      data: {
        model: { name: 'Aivestor Trade Suggestions', version: 'enhanced-gradient-boosting-v2' },
        suggestions: [{ symbol: 'AAPL', action: 'Buy', confidence: 78, rationale: 'Model signal.' }],
      },
    });

    const result = await service.getAiTradeSuggestions({
      symbols: ['AAPL'],
      riskLevel: 'medium',
      quotes: [{ symbol: 'AAPL', name: 'Apple', price: 210, changePercent: 1.2 }],
    });

    expect(jwt.sign).toHaveBeenCalledWith(
      { service: 'backend', purpose: 'market-insights' },
      'test-secret',
      { expiresIn: '1h' }
    );
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:5001/trade_suggestions',
      { tickers: ['AAPL'], risk_tolerance: 'medium' },
      expect.objectContaining({ headers: { Authorization: 'Bearer service-token' } })
    );
    expect(result.suggestions[0]).toEqual(expect.objectContaining({ name: 'Apple', price: 210, changePercent: 1.2 }));
    expect(redisCache.setJson).toHaveBeenCalledWith(
      'aivestor:ai:trade-suggestions:v2:medium:AAPL',
      expect.any(Object),
      300000
    );
  });

  test('uses a fresh distributed model cache without calling Flask', async () => {
    const entry = {
      time: Date.now(),
      data: {
        model: { name: 'Aivestor Trade Suggestions', version: 'enhanced-gradient-boosting-v2' },
        suggestions: [{ symbol: 'MSFT', name: 'Microsoft', action: 'Hold', confidence: 61, rationale: 'Cached.' }],
      },
    };
    const { axios, service } = loadService({ getJson: jest.fn().mockResolvedValue(entry) });

    const result = await service.getAiTradeSuggestions({ symbols: ['MSFT'], quotes: [] });

    expect(result.cache).toEqual({ status: 'hit', layer: 'redis' });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
