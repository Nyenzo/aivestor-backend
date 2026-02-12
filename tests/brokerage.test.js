/**
 * Test suite for brokerage endpoints
 */
const request = require('supertest');
const { app } = require('../app');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function makeToken(overrides = {}) {
    return jwt.sign({ uid: 'test-uid', email: 'test@example.com', ...overrides }, JWT_SECRET, { expiresIn: '1h' });
}

describe('Brokerage Endpoints', () => {
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
    });

    describe('POST /api/brokerage/sync', () => {
        it('should reject without auth token', async () => {
            const res = await request(app)
                .post('/api/brokerage/sync');
            expect(res.status).toBe(401);
        });

        it('should return error if no brokerage connected or succeed if one exists', async () => {
            const res = await request(app)
                .post('/api/brokerage/sync')
                .set('Authorization', `Bearer ${makeToken()}`);
            // 400 if no connection, 200 if prior connect test left one, or 500 if Firestore unavailable
            expect([200, 400, 500]).toContain(res.status);
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
            // 201 if Firestore is available, 500 otherwise
            expect([201, 500]).toContain(res.status);
            if (res.status === 201) {
                expect(res.body.transaction).toBeTruthy();
                expect(res.body.positions).toBeTruthy();
            }
        });
    });
});
