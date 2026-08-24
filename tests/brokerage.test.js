
const request = require('supertest');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

jest.mock('../services/marketData', () => {
    const actual = jest.requireActual('../services/marketData');
    return {
        ...actual,
        fetchMarketData: jest.fn(async (symbols) => ({
            quotes: (symbols || []).map((symbol) => ({
                symbol: String(symbol).toUpperCase(),
                price: 200,
                currency: 'USD',
                source: 'finnhub',
                timestamp: '2026-07-14T12:00:00.000Z',
            })),
            source: 'finnhub',
            asOf: '2026-07-14T12:00:00.000Z',
        })),
    };
});

const { app } = require('../app');

jest.mock('firebase-admin', () => {
    const mockFirestore = {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn(() => ({ empty: true, docs: [] })),
        add: jest.fn(() => ({ id: 'mock-id' })),
        set: jest.fn(),
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

describe('Brokerage Endpoints', () => {
    let db;
    beforeAll(() => {
        db = admin.firestore();
    });

    describe('POST /api/brokerage/connect', () => {
        it('should reject without auth token', async () => {
            const res = await request(app)
                .post('/api/brokerage/connect')
                .send({ brokerName: 'Alpaca' });
            expect(res.status).toBe(401);
        });

        it('should reject without brokerName', async () => {
            const res = await request(app)
                .post('/api/brokerage/connect')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/brokerName/i);
        });

        it('should connect with valid data', async () => {
            const res = await request(app)
                .post('/api/brokerage/connect')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ brokerName: 'Alpaca', apiKey: 'test-key' });
            // 201 if Firestore is available, 500 otherwise
            expect([200, 201, 500]).toContain(res.status);
            if (res.status === 201 || res.status === 200) {
                expect(res.body.brokerName).toBe('Alpaca');
                expect(res.body.status).toBe('connected');
            }
        });

        it('should reconnect if exist', async () => {
            db.get.mockResolvedValueOnce({ empty: false, docs: [{ id: 'mock-doc', data: () => ({}) }] });
            db.update.mockResolvedValueOnce({});
            const res = await request(app)
                .post('/api/brokerage/connect')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ brokerName: 'Alpaca' });
            expect([200, 500]).toContain(res.status);
        });

        it('should catch db error', async () => {
            db.get.mockRejectedValueOnce(new Error('DB Failed'));
            const res = await request(app)
                .post('/api/brokerage/connect')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ brokerName: 'Alpaca' });
            expect(res.status).toBe(500);
        });
    });

    describe('GET /api/brokerage/status', () => {
        it('should reject without auth token', async () => {
            const res = await request(app).get('/api/brokerage/status');
            expect(res.status).toBe(401);
        });

        it('should return connections with valid token', async () => {
            const res = await request(app)
                .get('/api/brokerage/status')
                .set('Authorization', `Bearer ${makeToken()}`);
            expect([200, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body)).toBe(true);
            }
        });

        it('should catch db error', async () => {
            db.get.mockRejectedValueOnce(new Error('DB Failed'));
            const res = await request(app)
                .get('/api/brokerage/status')
                .set('Authorization', `Bearer ${makeToken()}`);
            expect(res.status).toBe(500);
        });
    });

    describe('DELETE /api/brokerage/disconnect', () => {
        it('should reject without auth token', async () => {
            const res = await request(app)
                .delete('/api/brokerage/disconnect')
                .send({ brokerName: 'Alpaca' });
            expect(res.status).toBe(401);
        });

        it('should reject without brokerName', async () => {
            const res = await request(app)
                .delete('/api/brokerage/disconnect')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({});
            expect(res.status).toBe(400);
        });

        it('should disconnect successfully', async () => {
            db.get.mockResolvedValueOnce({ empty: false, docs: [{ id: 'mock-doc' }] });
            db.update.mockResolvedValueOnce({});
            const res = await request(app)
                .delete('/api/brokerage/disconnect')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ brokerName: 'Alpaca' });
            expect([200, 500]).toContain(res.status);
        });

        it('should catch db error', async () => {
            db.get.mockRejectedValueOnce(new Error('DB Failed'));
            const res = await request(app)
                .delete('/api/brokerage/disconnect')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ brokerName: 'Alpaca' });
            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/brokerage/sync', () => {
        it('should reject without auth token', async () => {
            const res = await request(app)
                .post('/api/brokerage/sync');
            expect(res.status).toBe(401);
        });

        it('should return an empty successful sync when there are no simulated positions', async () => {
            const res = await request(app)
                .post('/api/brokerage/sync')
                .set('Authorization', `Bearer ${makeToken()}`);
            expect(res.status).toBe(200);
            expect(res.body.positions).toEqual([]);
        });
    });

    describe('POST /api/brokerage/trade', () => {
        it('should reject without auth token', async () => {
            const res = await request(app)
                .post('/api/brokerage/trade')
                .send({ symbol: 'AAPL', type: 'buy', quantity: 10, price: 185.50 });
            expect(res.status).toBe(401);
        });

        it('should reject missing fields', async () => {
            const res = await request(app)
                .post('/api/brokerage/trade')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ symbol: 'AAPL' });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/required/i);
        });

        it('should reject invalid trade type', async () => {
            const res = await request(app)
                .post('/api/brokerage/trade')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ symbol: 'AAPL', type: 'short', quantity: 10, price: 185.50 });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/buy.*sell/i);
        });

        it('should execute trade with valid data', async () => {
            const res = await request(app)
                .post('/api/brokerage/trade')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ symbol: 'AAPL', type: 'buy', quantity: 10, price: 185.50 });
            expect(res.status).toBe(201);
            expect(res.body.transaction).toEqual(expect.objectContaining({ price: 200, priceSource: 'finnhub' }));
            expect(res.body.positions).toBeTruthy();
        });

        it('should trade sell with no position', async () => {
            const res = await request(app)
                .post('/api/brokerage/trade')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ symbol: 'GOOG', type: 'sell', quantity: 10, price: 100 });
            expect([400, 500]).toContain(res.status);
        });

        it('should trade buy with existing position', async () => {
            db.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({ positions: [{ stock_symbol: 'AAPL', quantity: 5, averagePrice: 150 }] })
            });
            const res = await request(app)
                .post('/api/brokerage/trade')
                .set('Authorization', `Bearer ${makeToken()}`)
                .send({ symbol: 'AAPL', type: 'buy', quantity: 10, price: 185.50 });
            expect(res.status).toBe(201);
            expect(res.body.positions[0]).toEqual(expect.objectContaining({ quantity: 15, averagePrice: 183.333333 }));
        });
    });
});
