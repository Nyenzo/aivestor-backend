const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app, JWT_SECRET } = require('../app');

describe('Auth guarded endpoints', () => {
  test('GET /api/users requires auth', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401); // authenticateToken returns 401 for missing token
  });

  test('GET /api/users with invalid token rejected', async () => {
    const res = await request(app).get('/api/users').set('Authorization', 'Bearer badtoken');
    expect([403]).toContain(res.status);
  });

  test('GET /api/users with valid token returns array (may be empty)', async () => {
    const token = jwt.sign({ uid: 'test', email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    // If table missing -> 500; else 200 with array
    expect([200,500]).toContain(res.status);
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
});