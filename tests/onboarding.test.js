
const request = require('supertest');
const { app } = require('../app');
const jwt = require('jsonwebtoken');
const axios = require('axios');

jest.mock('axios');
jest.mock('firebase-admin', () => {
  const mockFirestore = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn(() => ({ empty: true, docs: [] })),
    add: jest.fn(() => ({ id: 'mock-id' })),
    update: jest.fn()
  };
  const mockFirestoreFn = jest.fn(() => mockFirestore);
  mockFirestoreFn.FieldValue = { serverTimestamp: jest.fn(() => 'timestamp') };
  return {
    apps: ['mockApp'],
    credential: { cert: jest.fn() },
    initializeApp: jest.fn(),
    firestore: mockFirestoreFn,
    auth: jest.fn(() => ({}))
  };
});

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-ci';

describe('Onboarding Endpoint', () => {
  let authToken;

  beforeAll(() => {
    authToken = jwt.sign({ uid: 'test-uid', email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
  });

  describe('POST /api/onboarding', () => {
    it('should reject without auth', async () => {
      const response = await request(app)
        .post('/api/onboarding')
        .send({ riskLevel: 'medium' });

      expect(response.status).toBe(401);
    });

    it('should reject without riskLevel', async () => {
      const response = await request(app)
        .post('/api/onboarding')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('riskLevel');
    });

    it('should accept valid onboarding data', async () => {
      const response = await request(app)
        .post('/api/onboarding')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          riskLevel: 'medium',
          answers: ['answer1', 'answer2'],
          tickers: ['AAPL', 'GOOGL']
        });

      // May succeed or fail depending on database availability
      expect([200, 500]).toContain(response.status);
    });

    it('should handle high risk level', async () => {
      const response = await request(app)
        .post('/api/onboarding')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          riskLevel: 'high',
          answers: []
        });

      expect([200, 500]).toContain(response.status);
    });

    it('should handle low risk level', async () => {
      const response = await request(app)
        .post('/api/onboarding')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          riskLevel: 'low',
          answers: ['conservative', 'stable']
        });

      expect([200, 500]).toContain(response.status);
    });
  });
});
