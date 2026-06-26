const jwt = require('jsonwebtoken');
const { config } = require('../config/env');

const JWT_SECRET = config.jwtSecret;

// JWT auth middleware — extracted to avoid circular dependencies with app.js
const authenticateToken = (req, _res, next) => {
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.split(' ')[1];
    const cookieToken = req.cookies?.aivestor_session;
    const token = bearerToken || cookieToken;
    if (!token) return _res.status(401).json({ error: 'Access denied, no token provided' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return _res.status(403).json({ error: 'Invalid token' });
    }
};

module.exports = { authenticateToken, JWT_SECRET };
