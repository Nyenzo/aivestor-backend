const express = require('express');
const admin = require('../services/firebaseAdmin');
const { authenticateToken } = require('../middleware/auth');
const { fetchMarketData } = require('../services/marketData');
const { applyPaperOrder, validatePaperOrder } = require('../services/paperTrading');

const router = express.Router();
const db = admin.firestore();

function publicConnection(connection = {}) {
    const { apiKey, apiSecret, accessToken, refreshToken, ...safeConnection } = connection;
    return safeConnection;
}

// Paper connections identify a simulated workflow only; provider credentials are never persisted here.
router.post('/connect', authenticateToken, async (req, res) => {
    const { brokerName } = req.body;
    if (!brokerName) return res.status(400).json({ error: 'brokerName is required' });
    try {
        const data = {
            user_id: req.user.uid,
            brokerName,
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
            return res.json(publicConnection({ id: docId, ...data, message: 'Reconnected' }));
        }
        const ref = await db.collection('brokerageConnections').add(data);
        res.status(201).json(publicConnection({ id: ref.id, ...data, message: 'Connected' }));
    } catch (err) {
        res.status(500).json({ error: 'Unable to save the simulated brokerage connection' });
    }
});

// GET /api/brokerage/status — get all connections for user
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const snap = await db.collection('brokerageConnections')
            .where('user_id', '==', req.user.uid).get();
        res.json(snap.docs.map(d => publicConnection({ id: d.id, ...d.data() })));
    } catch (err) {
        res.status(500).json({ error: 'Unable to load simulated brokerage connections' });
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
        res.status(500).json({ error: 'Unable to load the simulated portfolio' });
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
        res.status(500).json({ error: 'Unable to disconnect the simulated brokerage connection' });
    }
});

// Synchronize existing paper positions from the shared live market-data service.
router.post('/sync', authenticateToken, async (req, res) => {
    try {
        const portfolioRef = db.collection('portfolios').doc(req.user.uid);
        const existingPortfolio = await portfolioRef.get();
        const existingPositions = existingPortfolio.exists ? (existingPortfolio.data().positions || []) : [];
        const basePositions = existingPositions;
        const symbols = basePositions.map((position) => position.stock_symbol);
        if (!symbols.length) {
            return res.json({ message: 'Portfolio has no simulated positions to synchronize', positions: [], source: null, asOf: null });
        }
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
        res.status(502).json({ error: 'Unable to synchronize simulated portfolio prices' });
    }
});

// Execute paper trades at a server-observed market price; the client price is display-only.
router.post('/trade', authenticateToken, async (req, res) => {
    const validation = validatePaperOrder(req.body);
    if (validation.error) return res.status(400).json({ error: validation.error });

    try {
        const order = validation.value;
        const marketData = await fetchMarketData([order.symbol]);
        const quote = marketData.quotes.find((entry) => entry.symbol === order.symbol);
        if (!quote || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0) {
            return res.status(422).json({ error: `No current executable market price is available for ${order.symbol}` });
        }

        const portfolioRef = db.collection('portfolios').doc(req.user.uid);
        const portfolioSnap = await portfolioRef.get();
        const existingPositions = portfolioSnap.exists ? (portfolioSnap.data().positions || []) : [];
        const positionUpdate = applyPaperOrder(existingPositions, {
            ...order,
            price: Number(quote.price),
            currency: quote.currency || 'USD',
            source: quote.source || marketData.source || 'market-data',
            timestamp: quote.timestamp || marketData.asOf,
        });
        if (positionUpdate.error) return res.status(400).json({ error: positionUpdate.error });

        const txData = {
            userId: req.user.uid,
            symbol: order.symbol,
            type: order.type,
            quantity: order.quantity,
            price: Number(quote.price),
            total: Number(order.quantity) * Number(quote.price),
            currency: quote.currency || 'USD',
            priceSource: quote.source || marketData.source || 'market-data',
            priceTimestamp: quote.timestamp || marketData.asOf,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        };
        const txRef = await db.collection('transactions').add(txData);

        await portfolioRef.set({ userId: req.user.uid, positions: positionUpdate.positions, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        res.status(201).json({ transaction: { id: txRef.id, ...txData }, positions: positionUpdate.positions });
    } catch (err) {
        res.status(502).json({ error: 'Unable to execute the simulated trade at a live market price' });
    }
});

module.exports = router;
