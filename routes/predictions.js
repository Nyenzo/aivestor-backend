const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Configuring the AI service URL and JWT secret
const AI_SERVICE_URL = 'http://localhost:5001';
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secure-secret-key';

// Route to get AI prediction for a single ticker
router.get('/predict/:ticker', async (req, res) => {
    try {
        const token = jwt.sign({ service: 'backend' }, JWT_SECRET, { expiresIn: '1h' });
        const response = await axios.get(`${AI_SERVICE_URL}/predict/${req.params.ticker}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        res.json(response.data);
    } catch (error) {
        console.error(`Error fetching prediction for ${req.params.ticker}:`, error.message);
        res.status(500).json({ error: `AI service error: ${error.message}` });
    }
});

// Route to get portfolio recommendations based on tickers and risk tolerance
router.post('/portfolio', async (req, res) => {
    try {
        const { tickers, risk_tolerance } = req.body;
        if (!tickers || !Array.isArray(tickers) || !risk_tolerance) {
            return res.status(400).json({ error: 'Invalid request: tickers and risk_tolerance required' });
        }
        const token = jwt.sign({ service: 'backend' }, JWT_SECRET, { expiresIn: '1h' });
        const response = await axios.post(`${AI_SERVICE_URL}/portfolio`, { tickers, risk_tolerance }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching portfolio recommendation:', error.message);
        res.status(500).json({ error: `AI service error: ${error.message}` });
    }
});

module.exports = router;