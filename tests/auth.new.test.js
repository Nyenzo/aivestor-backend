/**
 * Test suite for authentication endpoints
 * Auth routes are now consolidated in app.js and testable via supertest
 */
const request = require('supertest');
const { app } = require('../app');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('Authentication API', () => {
  describe('POST /api/auth/register', () => {
    it('should reject registration without email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ password: 'Password123!' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/email/i);
    });

    it('should reject registration without password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/password/i);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should reject login without credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/email.*password/i);
    });

    it('should reject login without password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/google', () => {
    it('should reject without ID token', async () => {
      const response = await request(app)
        .post('/api/auth/google')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/token/i);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should reject without email', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/email/i);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('should reject without token and password', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/token.*password/i);
    });

    it('should reject invalid reset token', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'invalid-token', password: 'NewPass123!' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('should reject without token', async () => {
      const response = await request(app)
        .post('/api/auth/verify-email')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/token/i);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should reject without auth token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh');

      expect(response.status).toBe(401);
    });

    it('should accept valid token and return refreshed token', async () => {
      const token = jwt.sign({ uid: 'test-uid', email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.token).toBeTruthy();
      expect(response.body.message).toMatch(/refreshed/i);
    });
  });

  describe('Authentication Middleware', () => {
    it('should reject requests without auth token', async () => {
      const response = await request(app).get('/api/users');
      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid token', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', 'Bearer invalid-token');
      expect(response.status).toBe(403);
    });

    it('should accept requests with valid token', async () => {
      const token = jwt.sign({ uid: 'test-uid', email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${token}`);
      // Should pass auth middleware (200 or 500 depending on Firestore)
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('JWT Token Generation', () => {
    it('should create valid JWT tokens', () => {
      const payload = { uid: 'test-uid', email: 'test@example.com' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
      expect(token).toBeTruthy();
      const decoded = jwt.verify(token, JWT_SECRET);
      expect(decoded.uid).toBe('test-uid');
      expect(decoded.email).toBe('test@example.com');
    });

    it('should reject expired tokens', () => {
      const token = jwt.sign({ uid: 'test-uid' }, JWT_SECRET, { expiresIn: '-1h' });
      expect(() => jwt.verify(token, JWT_SECRET)).toThrow();
    });

    it('should reject tampered tokens', () => {
      const token = jwt.sign({ uid: 'test-uid' }, JWT_SECRET, { expiresIn: '1h' });
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(() => jwt.verify(tampered, JWT_SECRET)).toThrow();
    });
  });
});
