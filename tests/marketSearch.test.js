describe('market symbol search', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.FINNHUB_API_KEY = 'test-finnhub-key';
  });

  function loadMarketData(redisOverrides = {}) {
    jest.doMock('../services/redisCache', () => ({
      buildCacheKey: jest.fn((namespace, key) => `aivestor:${namespace}:${key}`),
      getJson: jest.fn().mockResolvedValue(null),
      isEnabled: jest.fn(() => true),
      setJson: jest.fn().mockResolvedValue(true),
      ...redisOverrides,
    }));
    jest.doMock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

    return {
      axios: require('axios'),
      marketData: require('../services/marketData'),
      redisCache: require('../services/redisCache'),
    };
  }

  test('normalizes Finnhub symbol search results and caches them', async () => {
    const { axios, marketData, redisCache } = loadMarketData();
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        result: [
          { symbol: 'MSFT', displaySymbol: 'MSFT', description: 'MICROSOFT CORP', type: 'Common Stock' },
          { symbol: '', description: 'invalid' },
        ],
      },
    });

    const results = await marketData.searchMarketSymbols('microsoft');

    expect(results).toEqual([{
      symbol: 'MSFT',
      displaySymbol: 'MSFT',
      name: 'MICROSOFT CORP',
      type: 'Common Stock',
    }]);
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/search'),
      expect.objectContaining({ params: { q: 'microsoft', exchange: 'US' } })
    );
    expect(redisCache.setJson).toHaveBeenCalledWith(
      'aivestor:market:search:v1:microsoft',
      expect.objectContaining({ results }),
      600000
    );
  });

  test('serves a fresh distributed cache entry without calling Finnhub', async () => {
    const entry = { time: Date.now(), results: [{ symbol: 'SPY', displaySymbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'ETF' }] };
    const { axios, marketData } = loadMarketData({ getJson: jest.fn().mockResolvedValue(entry) });

    await expect(marketData.searchMarketSymbols('spy')).resolves.toEqual(entry.results);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('adds the verified SpaceX public listing when Finnhub search has not indexed it yet', async () => {
    const { axios, marketData } = loadMarketData();
    axios.get.mockResolvedValue({ status: 200, data: { result: [] } });

    await expect(marketData.searchMarketSymbols('SpaceX')).resolves.toEqual([{
      symbol: 'SPCX',
      displaySymbol: 'SPCX',
      name: 'SpaceX',
      type: 'Common Stock',
    }]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('does not let an old empty distributed search cache hide the SpaceX listing', async () => {
    const entry = { time: Date.now(), results: [] };
    const { axios, marketData } = loadMarketData({ getJson: jest.fn().mockResolvedValue(entry) });

    await expect(marketData.searchMarketSymbols('spacex')).resolves.toEqual([{
      symbol: 'SPCX',
      displaySymbol: 'SPCX',
      name: 'SpaceX',
      type: 'Common Stock',
    }]);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
