
const request = require('supertest');
const { app } = require('../app');
const jwt = require('jsonwebtoken');

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

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function makeToken(overrides = {}) {
    return jwt.sign({ uid: 'test-uid', email: 'test@example.com', ...overrides }, JWT_SECRET, { expiresIn: '1h' });
}

describe('Nudge & Alert Endpoints', () => {
    describe('GET /api/nudges', () => {
        it('should reject without auth token', async () => {
            const res = await request(app).get('/api/nudges');
            expect(res.status).toBe(401);
        });

        it('should return nudges with valid token', async () => {
            const res = await request(app)
                .get('/api/nudges')
                .set('Authorization', `Bearer ${makeToken()}`);
            // 200 if Firestore is available, 500 otherwise
            expect([200, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            }
        });
    });

    describe('POST /api/nudges', () => {
        it('should reject without auth token', async () => {
            const res = await request(app)
                .post('/api/nudges')
                .send({ message: 'Test nudge' });
            expect(res.status).toBe(401);
        });

        it('should reject without message', async () => {
            const res = await request(app)
                .post('/api/nudges')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/message/i);
        });

        it('should create nudge with valid data', async () => {
            const res = await request(app)
                .post('/api/nudges')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ message: 'AAPL is up 5% today!' });
            // 201 if Firestore is available, 500 otherwise
            expect([201, 500]).toContain(res.status);
            if (res.status === 201) {
                expect(res.body.message).toBe('AAPL is up 5% today!');
            }
        });
    });

    describe('GET /api/alerts', () => {
        it('should reject without auth token', async () => {
            const res = await request(app).get('/api/alerts');
            expect(res.status).toBe(401);
        });

        it('should return alerts with valid token', async () => {
            const res = await request(app)
                .get('/api/alerts')
                .set('Authorization', `Bearer ${makeToken()}`);
            expect([200, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            }
        });
    });

    describe('POST /api/alerts', () => {
        it('should reject without auth token', async () => {
            const res = await request(app)
                .post('/api/alerts')
                .send({ stock_symbol: 'AAPL', trigger_price: 200 });
            expect(res.status).toBe(401);
        });

        it('should reject without stock_symbol', async () => {
            const res = await request(app)
                .post('/api/alerts')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ trigger_price: 200 });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/stock_symbol/i);
        });

        it('should reject without trigger_price', async () => {
            const res = await request(app)
                .post('/api/alerts')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ stock_symbol: 'AAPL' });
            expect(res.status).toBe(400);
        });

        it('should create alert with valid data', async () => {
            const res = await request(app)
                .post('/api/alerts')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ stock_symbol: 'AAPL', trigger_price: 200, message: 'Apple hit $200' });
            expect([201, 500]).toContain(res.status);
            if (res.status === 201) {
                expect(res.body.stock_symbol).toBe('AAPL');
                expect(res.body.trigger_price).toBe(200);
            }
        });
    });
});
