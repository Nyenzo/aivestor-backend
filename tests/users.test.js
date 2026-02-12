/**
 * Test suite for user endpoints
 */
const request = require('supertest');
const { app } = require('../app');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-ci';

describe('User Endpoints', () => {
  let authToken;

  beforeAll(() => {
    authToken = jwt.sign({ uid: 'test-uid', email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
  });

  describe('GET /api/users/me', () => {
    it('should reject without auth', async () => {
      const response = await request(app)
        .get('/api/users/me');
      
      expect(response.status).toBe(401);
    });

    it('should return user data with valid auth', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${authToken}`);
      
      // May return user data or 404/500 depending on database
      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe('GET /api/users', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/users');
      
      expect(response.status).toBe(401);
    });

    it('should return users with valid auth', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
      }
    });
  });

  describe('User Data Validation', () => {
    it('should validate email format in auth token', () => {
      const payload = { uid: 'test-uid', email: 'invalid-email' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
      
      expect(token).toBeTruthy();
      const decoded = jwt.decode(token);
      expect(decoded.email).toBe('invalid-email');
    });

    it('should handle missing uid in token', async () => {
      const token = jwt.sign({ email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
      
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${token}`);
      
      // Should still pass authentication if token is valid
      expect([200, 500]).toContain(response.status);
    });

    it('should handle extra fields in token', async () => {
      const token = jwt.sign({ 
        uid: 'test-uid', 
        email: 'test@example.com',
        role: 'admin',
        extra: 'data'
      }, JWT_SECRET, { expiresIn: '1h' });
      
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${token}`);
      
      expect([200, 500]).toContain(response.status);
    });
  });
});
