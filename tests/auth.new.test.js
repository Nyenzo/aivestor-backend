const request = require('supertest');
const { app } = require('../app');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('axios');

jest.mock('firebase-admin', () => {
  const mockFirestore = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn(),
    add: jest.fn(),
    update: jest.fn()
  };
  const mockAuth = {
    createUser: jest.fn(),
    getUserByEmail: jest.fn(),
    verifyIdToken: jest.fn(),
    updateUser: jest.fn()
  };
  mockFirestore.FieldValue = { serverTimestamp: jest.fn(() => 'timestamp') };
  const mockFirestoreFn = jest.fn(() => mockFirestore);
  mockFirestoreFn.FieldValue = { serverTimestamp: jest.fn(() => 'timestamp') };

  return {
    apps: ['mockApp'],
    credential: { cert: jest.fn() },
    initializeApp: jest.fn(),
    firestore: mockFirestoreFn,
    auth: jest.fn(() => mockAuth)
  };
});

describe('Authentication API', () => {
  let db;

  beforeAll(() => {
    db = admin.firestore();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should register successfully', async () => {
      admin.auth().createUser.mockResolvedValueOnce({ uid: 'new-uid', email: 'test@example.com' });
      db.get.mockResolvedValueOnce({ empty: true });
      db.add.mockResolvedValueOnce({ id: 'doc-id' });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com', password: 'Password123!', risk_tolerance: 0.8 });

      expect(res.status).toBe(201);
      expect(res.body.firebaseUid).toBe('new-uid');
    });

    it('should reject without email', async () => {
      const res = await request(app).post('/api/auth/register').send({ password: 'Password123!' });
      expect(res.status).toBe(400);
    });

    it('handles firebase errors', async () => {
      admin.auth().createUser.mockRejectedValueOnce(new Error('Firebase Error'));
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com', password: 'Password123!' });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login successfully', async () => {
      // login now verifies via Firebase Identity Toolkit REST API
      axios.post.mockResolvedValueOnce({ data: { localId: 'new-uid', email: 'test@example.com' } });
      db.get.mockResolvedValueOnce({ empty: false, docs: [{ id: 'doc-id', data: () => ({ email: 'test@example.com' }) }] });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'Password123!' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it('should reject without credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('handles firebase invalid credentials', async () => {
      axios.post.mockRejectedValueOnce(new Error('Auth Failed'));
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'WrongPassword' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/google', () => {
    it('verifies token and logs in', async () => {
      admin.auth().verifyIdToken.mockResolvedValueOnce({ uid: 'new-uid', email: 'test@example.com' });
      db.get.mockResolvedValueOnce({ empty: true });
      db.add.mockResolvedValueOnce({ id: 'doc-id' });

      const res = await request(app)
        .post('/api/auth/google')
        .send({ idToken: 'valid.google.token' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it('rejects without ID token', async () => {
      const res = await request(app).post('/api/auth/google').send({});
      expect(res.status).toBe(400);
    });

    it('handles invalid google token', async () => {
      admin.auth().verifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));
      const res = await request(app)
        .post('/api/auth/google')
        .send({ idToken: 'invalid.google.token' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('does NOT return token in response (token delivered out-of-band via email)', async () => {
      db.get.mockResolvedValueOnce({ empty: false, docs: [{ id: 'doc-id', data: () => ({ email: 'test@example.com' }) }] });
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(200);
      // Token must NOT be in the response body — it should be emailed instead
      expect(res.body.token).toBeUndefined();
      expect(res.body.message).toBeDefined();
    });

    it('returns generic message if user not found to prevent probing', async () => {
      db.get.mockResolvedValueOnce({ empty: true });
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'ghost@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeUndefined();
    });

    it('rejects without email', async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('handles invalid reset token', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'invalid-token', password: 'NewPass123!' });
      expect(res.status).toBe(400);
    });

    it('rejects without token and password', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('handles invalid token', async () => {
      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'bad-token' });
      expect(res.status).toBe(400);
    });

    it('rejects without token', async () => {
      const res = await request(app).post('/api/auth/verify-email').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/send-verification', () => {
    it('does NOT return token in response (token delivered out-of-band via email)', async () => {
      const token = jwt.sign({ uid: 'test', email: 'test@ex.com' }, JWT_SECRET, { expiresIn: '1h' });
      const res = await request(app)
        .post('/api/auth/send-verification')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      // Token must NOT be in the response body
      expect(res.body.token).toBeUndefined();
      expect(res.body.message).toBeDefined();
    });
  });

});
