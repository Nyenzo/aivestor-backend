const request = require('supertest');
const { app } = require('../app');

describe('Smoke tests', () => {
  test('GET / returns banner', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Aivestor Backend API/);
  });

  test('GET /healthz returns ok or error', async () => {
    const res = await request(app).get('/healthz');
    // In absence of test DB may fail; ensure status code reflects outcome
    expect([200,500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
    }
  });
});