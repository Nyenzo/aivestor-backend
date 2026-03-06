const request = require('supertest');
const { app } = require('../app');
const axios = require('axios');
const jwt = require('jsonwebtoken');

jest.mock('axios');
jest.mock('firebase-admin', () => {
    return {
        apps: ['mockApp'],
        credential: { cert: jest.fn() },
        initializeApp: jest.fn(),
        firestore: jest.fn(() => ({
            collection: jest.fn().mockReturnThis(),
            doc: jest.fn().mockReturnThis(),
            get: jest.fn(),
        })),
        auth: jest.fn(() => ({}))
    };
});

describe('Predictions API Endpoints', () => {
    let token;
    const mockUid = 'test-uid';
    const mockEmail = 'test@example.com';

    beforeAll(() => {
        const secret = process.env.JWT_SECRET || 'your-very-secure-secret-key';
        token = jwt.sign({ uid: mockUid, email: mockEmail }, secret, { expiresIn: '1h' });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/predict/:ticker', () => {
        it('returns 404 if ticker not provided', async () => {
            const res = await request(app)
                .get('/api/predict/ ')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(404);
        });

        it('returns prediction data from ai bot', async () => {
            axios.get.mockResolvedValueOnce({ data: { ticker: 'AAPL', prediction: 150 } });
            const res = await request(app)
                .get('/api/predict/AAPL')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(res.body.ticker).toBe('AAPL');
        });

        it('handles AI service error via GET /predict', async () => {
            axios.get.mockRejectedValueOnce(new Error('AI Failed'));
            const res = await request(app)
                .get('/api/predict/AAPL')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/chat', () => {
        it('returns 400 if message is empty', async () => {
            const res = await request(app)
                .post('/api/chat')
                .set('Authorization', `Bearer ${token}`)
                .send({ message: '' });
            expect(res.status).toBe(400);
        });

        it('returns answer from AI service chat', async () => {
            axios.post.mockResolvedValueOnce({ data: { answer: 'AI RAG Response' } });
            const res = await request(app)
                .post('/api/chat')
                .set('Authorization', `Bearer ${token}`)
                .send({ message: 'What is Aivestor?' });
            expect(res.status).toBe(200);
            expect(res.body.answer).toBe('AI RAG Response');
        });

        it('returns fallback on AI service error', async () => {
            axios.post.mockRejectedValueOnce(new Error('AI Failed'));
            const res = await request(app)
                .post('/api/chat')
                .set('Authorization', `Bearer ${token}`)
                .send({ message: 'Error out' });
            expect(res.status).toBe(503);
            expect(res.body.error).toContain('AI Chatbot is currently unavailable');
        });
    });

    describe('POST /portfolio', () => {
        it('returns 400 if invalid request', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .set('Authorization', `Bearer ${token}`)
                .send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Invalid request');
        });

        it('returns recommendation from AI', async () => {
            axios.post.mockResolvedValueOnce({ data: { recommendation: 'Buy AAPL' } });
            const res = await request(app)
                .post('/api/portfolio')
                .set('Authorization', `Bearer ${token}`)
                .send({ tickers: ['AAPL'], risk_tolerance: 0.5 });
            expect(res.status).toBe(200);
            expect(res.body.recommendation).toBe('Buy AAPL');
        });

        it('handles AI service error', async () => {
            axios.post.mockRejectedValueOnce(new Error('AI Failed'));
            const res = await request(app)
                .post('/api/portfolio')
                .set('Authorization', `Bearer ${token}`)
                .send({ tickers: ['AAPL'], risk_tolerance: 0.5 });
            expect(res.status).toBe(500);
        });
    });

    describe('GET /history/:ticker', () => {
        it('returns history from AI', async () => {
            axios.get.mockResolvedValueOnce({ data: { history: [1, 2, 3] } });
            const res = await request(app)
                .get('/api/history/AAPL')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
        });

        it('handles AI service error', async () => {
            axios.get.mockRejectedValueOnce(new Error('AI Failed'));
            const res = await request(app)
                .get('/api/history/AAPL')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(500);
        });
    });
});
