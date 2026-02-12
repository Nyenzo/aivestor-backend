const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// JWT auth middleware — extracted to avoid circular dependencies with app.js
const authenticateToken = (req, _res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return _res.status(401).json({ error: 'Access denied, no token provided' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return _res.status(403).json({ error: 'Invalid token' });
    }
};

module.exports = { authenticateToken, JWT_SECRET };
