const express = require('express');
const admin = require('../services/firebaseAdmin');
const { authenticateToken } = require('../middleware/auth');
const { fetchMarketData } = require('../services/marketData');

const router = express.Router();
const db = admin.firestore();

const DEFAULT_BROKERAGE_POSITIONS = [
    { stock_symbol: 'AAPL', quantity: 15 },
    { stock_symbol: 'MSFT', quantity: 10 },
    { stock_symbol: 'GOOGL', quantity: 8 },
    { stock_symbol: 'NVDA', quantity: 5 },
    { stock_symbol: 'AMZN', quantity: 12 }
];

// POST /api/brokerage/connect — connect brokerage credentials
router.post('/connect', authenticateToken, async (req, res) => {
    const { brokerName, apiKey } = req.body;
    if (!brokerName) return res.status(400).json({ error: 'brokerName is required' });
    try {
        const data = {
            user_id: req.user.uid,
            brokerName,
            apiKey: apiKey || null,
            status: 'connected',
            connectedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const existing = await db.collection('brokerageConnections')
            .where('user_id', '==', req.user.uid)
            .where('brokerName', '==', brokerName)
            .limit(1).get();
        if (!existing.empty) {
            const docId = existing.docs[0].id;
            await db.collection('brokerageConnections').doc(docId).update({ status: 'connected', connectedAt: admin.firestore.FieldValue.serverTimestamp() });
            return res.json({ id: docId, ...data, message: 'Reconnected' });
        }
        const ref = await db.collection('brokerageConnections').add(data);
        res.status(201).json({ id: ref.id, ...data, message: 'Connected' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/brokerage/status — get all connections for user
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const snap = await db.collection('brokerageConnections')
            .where('user_id', '==', req.user.uid).get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/brokerage/portfolio — read simulated portfolio positions for user
router.get('/portfolio', authenticateToken, async (req, res) => {
    try {
        const portfolioRef = db.collection('portfolios').doc(req.user.uid);
        const portfolioSnap = await portfolioRef.get();
        if (!portfolioSnap.exists) {
            return res.json({ userId: req.user.uid, positions: [] });
        }
        const portfolio = portfolioSnap.data() || {};
        res.json({
            id: portfolioSnap.id,
            userId: portfolio.userId || portfolio.user_id || req.user.uid,
            positions: portfolio.positions || [],
            syncedAt: portfolio.syncedAt || null,
            updatedAt: portfolio.updatedAt || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/brokerage/disconnect — disconnect a brokerage
router.delete('/disconnect', authenticateToken, async (req, res) => {
    const { brokerName } = req.body;
    if (!brokerName) return res.status(400).json({ error: 'brokerName is required' });
    try {
        const snap = await db.collection('brokerageConnections')
            .where('user_id', '==', req.user.uid)
            .where('brokerName', '==', brokerName)
            .limit(1).get();
        if (snap.empty) return res.status(404).json({ error: 'Connection not found' });
        await db.collection('brokerageConnections').doc(snap.docs[0].id).update({ status: 'disconnected' });
        res.json({ message: `Disconnected from ${brokerName}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/brokerage/sync — sync portfolio prices from Yahoo Finance
router.post('/sync', authenticateToken, async (req, res) => {
    try {
        const snap = await db.collection('brokerageConnections')
            .where('user_id', '==', req.user.uid)
            .where('status', '==', 'connected')
            .limit(1).get();
        if (snap.empty) return res.status(400).json({ error: 'No connected brokerage' });

        const portfolioRef = db.collection('portfolios').doc(req.user.uid);
        const existingPortfolio = await portfolioRef.get();
        const existingPositions = existingPortfolio.exists ? (existingPortfolio.data().positions || []) : [];
        const basePositions = existingPositions.length ? existingPositions : DEFAULT_BROKERAGE_POSITIONS;
        const symbols = basePositions.map((position) => position.stock_symbol);
        const marketData = await fetchMarketData(symbols, { force: true });
        const quotesBySymbol = new Map(marketData.quotes.map((quote) => [quote.symbol, quote]));

        const positions = basePositions.map((position) => {
            const quote = quotesBySymbol.get(position.stock_symbol);
            const currentPrice = quote?.price ?? position.currentPrice ?? position.averagePrice ?? 0;
            return {
                ...position,
                averagePrice: position.averagePrice ?? currentPrice,
                currentPrice,
                dailyChange: quote?.change ?? 0,
                dailyChangePercent: quote?.changePercent ?? 0,
                currency: quote?.currency ?? 'USD',
                priceSource: marketData.source || 'yahoo-finance',
                priceTimestamp: quote?.timestamp ?? marketData.asOf
            };
        });

        await portfolioRef.set({
            userId: req.user.uid,
            positions,
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        res.json({ message: 'Portfolio synced', positions, source: marketData.source || 'yahoo-finance', asOf: marketData.asOf });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/brokerage/trade — record a trade
router.post('/trade', authenticateToken, async (req, res) => {
    const { symbol, type, quantity, price } = req.body;
    if (!symbol || !type || !quantity || !price) {
        return res.status(400).json({ error: 'symbol, type (buy/sell), quantity, and price are required' });
    }
    if (!['buy', 'sell'].includes(type.toLowerCase())) {
        return res.status(400).json({ error: 'type must be buy or sell' });
    }
    try {
        // Record transaction
        const txData = {
            userId: req.user.uid,
            symbol: symbol.toUpperCase(),
            type: type.toLowerCase(),
            quantity: Number(quantity),
            price: Number(price),
            total: Number(quantity) * Number(price),
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };
        const txRef = await db.collection('transactions').add(txData);

        // Update portfolio positions
        const portfolioRef = db.collection('portfolios').doc(req.user.uid);
        const portfolioSnap = await portfolioRef.get();
        let positions = portfolioSnap.exists ? (portfolioSnap.data().positions || []) : [];

        const existingIdx = positions.findIndex(p => p.stock_symbol === symbol.toUpperCase());
        if (type.toLowerCase() === 'buy') {
            if (existingIdx >= 0) {
                const existing = positions[existingIdx];
                const newQty = existing.quantity + Number(quantity);
                const newAvg = ((existing.averagePrice * existing.quantity) + (Number(price) * Number(quantity))) / newQty;
                positions[existingIdx] = { ...existing, quantity: newQty, averagePrice: parseFloat(newAvg.toFixed(2)), currentPrice: Number(price) };
            } else {
                positions.push({ stock_symbol: symbol.toUpperCase(), quantity: Number(quantity), averagePrice: Number(price), currentPrice: Number(price) });
            }
        } else {
            if (existingIdx < 0) return res.status(400).json({ error: `No position in ${symbol}` });
            const existing = positions[existingIdx];
            if (existing.quantity < Number(quantity)) return res.status(400).json({ error: `Insufficient shares (have ${existing.quantity})` });
            const newQty = existing.quantity - Number(quantity);
            if (newQty === 0) { positions.splice(existingIdx, 1); }
            else { positions[existingIdx] = { ...existing, quantity: newQty }; }
        }

        await portfolioRef.set({ userId: req.user.uid, positions, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        res.status(201).json({ transaction: { id: txRef.id, ...txData }, positions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
