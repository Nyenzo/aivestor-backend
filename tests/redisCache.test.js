describe('redisCache', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadCacheWithAxios() {
    jest.doMock('axios', () => ({ post: jest.fn() }));
    const axios = require('axios');
    const redisCache = require('../services/redisCache');
    return { axios, redisCache };
  }

  test('is disabled without Upstash credentials', async () => {
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    const { axios, redisCache } = loadCacheWithAxios();

    await expect(redisCache.getJson('key')).resolves.toBeNull();
    await expect(redisCache.setJson('key', { ok: true }, 1000)).resolves.toBe(false);
    expect(redisCache.isEnabled()).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('reads JSON values through the Upstash REST command API', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const { axios, redisCache } = loadCacheWithAxios();
    axios.post.mockResolvedValueOnce({ status: 200, data: { result: '{"answer":42}' } });

    await expect(redisCache.getJson('aivestor:test')).resolves.toEqual({ answer: 42 });
    expect(axios.post).toHaveBeenCalledWith(
      'https://redis.example.com',
      ['GET', 'aivestor:test'],
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  test('writes JSON values with a bounded TTL', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const { axios, redisCache } = loadCacheWithAxios();
    axios.post.mockResolvedValueOnce({ status: 200, data: { result: 'OK' } });

    await expect(redisCache.setJson('aivestor:test', { ok: true }, 30000)).resolves.toBe(true);
    expect(axios.post).toHaveBeenCalledWith(
      'https://redis.example.com',
      ['SET', 'aivestor:test', '{"ok":true}', 'PX', 30000],
      expect.any(Object)
    );
  });

  test('sanitizes generated cache keys', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const { redisCache } = loadCacheWithAxios();

    expect(redisCache.buildCacheKey('market quotes', 'AAPL, MSFT')).toBe('aivestor:market:quotes:AAPL,MSFT');
  });
});
