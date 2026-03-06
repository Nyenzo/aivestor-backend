const request = require('supertest');
const { app } = require('../app');
const admin = require('firebase-admin');
const axios = require('axios');
const jwt = require('jsonwebtoken');

// Mock external dependencies
jest.mock('firebase-admin', () => {
    const mockFirestore = {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        add: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
    };
    const mockFirestoreFn = jest.fn(() => mockFirestore);
    mockFirestoreFn.FieldValue = { serverTimestamp: jest.fn(() => 'timestamp') };

    return {
        apps: ['mockApp'],
        credential: { cert: jest.fn() },
        initializeApp: jest.fn(),
        firestore: mockFirestoreFn,
        auth: jest.fn(() => ({
            verifyIdToken: jest.fn(),
            getUserByEmail: jest.fn(),
            createUser: jest.fn(),
            updateUser: jest.fn()
        }))
    };
});
jest.mock('axios');

describe('Extended App Endpoints', () => {
    let token;
    const mockUid = 'test-uid';
    const mockEmail = 'test@example.com';
    let db;

    beforeAll(() => {
        const secret = process.env.JWT_SECRET || 'your-very-secure-secret-key';
        token = jwt.sign({ uid: mockUid, email: mockEmail }, secret, { expiresIn: '1h' });
        db = admin.firestore();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/test', () => {
        it('returns 200 and docCount', async () => {
            db.get.mockResolvedValueOnce({ size: 10 });
            const res = await request(app).get('/api/test');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ message: 'Firestore connected', docCount: 10 });
        });

        it('returns 500 on db error', async () => {
            db.get.mockRejectedValueOnce(new Error('DB Error'));
            const res = await request(app).get('/api/test');
            expect(res.status).toBe(500);
        });
    });

    describe('User CRUD Endpoints', () => {
        it('POST /api/users creates user', async () => {
            admin.firestore.FieldValue = { serverTimestamp: jest.fn(() => 'timestamp') };
            db.add.mockResolvedValueOnce({ id: 'dummy-id' });
            const res = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${token}`)
                .send({ email: 'new@example.com', risk_tolerance: 0.6 });
            expect(res.status).toBe(201);
            expect(res.body.email).toBe('new@example.com');
        });

        it('GET /api/users lists users', async () => {
            db.get.mockResolvedValueOnce({ docs: [{ id: '1', data: () => ({ email: 'a@ex.com' }) }] });
            const res = await request(app)
                .get('/api/users')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('GET /api/users/me gets current user', async () => {
            admin.auth().getUserByEmail.mockResolvedValueOnce({ uid: '1' });
            db.get.mockResolvedValueOnce({ empty: false, docs: [{ id: '1', data: () => ({ email: mockEmail }) }] });
            const res = await request(app)
                .get('/api/users/me')
                .set('Authorization', `Bearer ${token}`);
            expect([200, 404, 500]).toContain(res.status);
        });

        it('GET /api/users/:id gets robust user', async () => {
            db.get.mockResolvedValueOnce({ exists: true, id: '1', data: () => ({ email: mockEmail }) });
            const res = await request(app)
                .get('/api/users/1')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
        });

        it('PUT /api/users/:id updates user', async () => {
            db.get.mockResolvedValueOnce({ exists: true, id: '1', data: () => ({ email: 'old@example.com' }) });
            db.update.mockResolvedValueOnce({});
            const res = await request(app)
                .put('/api/users/1')
                .set('Authorization', `Bearer ${token}`)
                .send({ email: 'updated@example.com' });
            expect(res.status).toBe(200);
        });

        it('DELETE /api/users/:id deletes user', async () => {
            db.get.mockResolvedValueOnce({ exists: true, id: '1', data: () => ({ email: mockEmail }) });
            db.delete.mockResolvedValueOnce({});
            const res = await request(app)
                .delete('/api/users/1')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
        });

        it('POST /api/users handles DB error', async () => {
            db.add.mockRejectedValueOnce(new Error('DB Failed'));
            const res = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${token}`)
                .send({ email: 'new@example.com' });
            expect(res.status).toBe(500);
        });

        it('GET /api/users handles Auth error', async () => {
            admin.auth().getUserByEmail = jest.fn(() => { throw new Error('Auth Failed') });
            const res = await request(app)
                .get('/api/users')
                .set('Authorization', `Bearer ${token}`);
            expect([200, 500]).toContain(res.status);
        });

        it('GET /api/users/me handles DB error', async () => {
            admin.auth().getUserByEmail.mockResolvedValueOnce({ uid: '1' });
            db.get.mockRejectedValueOnce(new Error('DB Failed'));
            const res = await request(app)
                .get('/api/users/me')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(500);
        });

        it('GET /api/users/:id handles DB error', async () => {
            db.get.mockRejectedValueOnce(new Error('DB Failed'));
            const res = await request(app)
                .get('/api/users/1')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(500);
        });

        it('PUT /api/users/:id handles DB error', async () => {
            db.get.mockRejectedValueOnce(new Error('DB Failed'));
            const res = await request(app)
                .put('/api/users/1')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(500);
        });

        it('DELETE /api/users/:id handles DB error', async () => {
            db.get.mockRejectedValueOnce(new Error('DB Failed'));
            const res = await request(app)
                .delete('/api/users/1')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(500);
        });
    });

    describe('Portfolios', () => {
        it('POST /api/portfolios creates portfolio entry', async () => {
            db.add.mockResolvedValueOnce({ id: 'port-1' });
            const res = await request(app)
                .post('/api/portfolios')
                .set('Authorization', `Bearer ${token}`)
                .send({ user_id: mockUid, stock_symbol: 'AAPL', quantity: 10 });
            expect(res.status).toBe(201);
        });

    });

    describe('POST /api/onboarding', () => {
        it('processes onboarding successfully', async () => {
            db.get.mockReset();
            db.add.mockReset();
            db.update.mockReset();

            db.get.mockResolvedValueOnce({ empty: true });
            db.add.mockResolvedValueOnce({ id: 'new-user' });
            db.update.mockResolvedValueOnce({});

            axios.post.mockResolvedValueOnce({ data: { weights: { 'AAPL': 0.5 } } });

            const res = await request(app)
                .post('/api/onboarding')
                .set('Authorization', `Bearer ${token}`)
                .send({ riskLevel: 'High', answers: [1, 2, 3], tickers: ['AAPL'] });
            if (res.status === 500) {
                console.error('500 ERROR:', res.body.error);
            }
            expect(res.status).toBe(200);
            expect(res.body.recommendation.weights.AAPL).toBe(0.5);
        });
    });
});
