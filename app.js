require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const predictionsRouter = require('./routes/predictions');
const { authenticateToken, JWT_SECRET } = require('./middleware/auth');

const app = express();

const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// Firebase Admin init (guard for tests)
if (!admin.apps.length) {
  try {
    const serviceAccount = require('./aivestor-firebase-adminsdk.json');
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Firebase admin init failed:', err.message);
    }
  }
}

// Firestore reference
const db = admin.firestore();

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:5001';
const DEFAULT_ONBOARDING_TICKERS = (process.env.ONBOARDING_TICKERS || 'SPY,QQQ,VTI,VXUS,BND')
  .split(',').map(t => t.trim()).filter(Boolean);

// In-memory token stores (use Redis in production)
const resetTokens = new Map();
const verificationTokens = new Map();

// Risk level to numeric tolerance
const mapRiskLevelToTolerance = (level = '') => {
  switch ((level || '').toLowerCase()) {
    case 'low': return 0.3;
    case 'high': return 0.7;
    case 'medium':
    default: return 0.5;
  }
};

// Look up user doc by email field
const getUserByEmail = async (email) => {
  if (!email) return null;
  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
};

// Create user doc if missing, return existing otherwise
const ensureUserRecord = async (email, riskLevel) => {
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  const riskTolerance = mapRiskLevelToTolerance(riskLevel);
  const data = {
    email,
    risk_tolerance: riskTolerance,
    risk_level: riskLevel || null,
    created_at: admin.firestore.FieldValue.serverTimestamp()
  };
  const ref = await db.collection('users').add(data);
  return { id: ref.id, ...data };
};

// JWT auth middleware re-exported from shared middleware for convenience
// (authenticateToken imported from ./middleware/auth at top of file)

// Root
app.get('/', (_req, res) => res.send('Aivestor Backend API'));
app.use('/api', predictionsRouter);

// Lazy-load brokerage router to avoid circular dependency
app.use('/api/brokerage', (req, res, next) => {
  const brokerageRouter = require('./routes/brokerage');
  brokerageRouter(req, res, next);
});

// Firestore connectivity check
app.get('/api/test', async (_req, res) => {
  try {
    const snap = await db.collection('users').limit(1).get();
    res.json({ message: 'Firestore connected', docCount: snap.size });
  } catch (err) {
    res.status(500).json({ message: 'Firestore error', error: err.message });
  }
});

// Health check
app.get('/healthz', async (_req, res) => {
  try {
    await db.collection('users').limit(1).get();
    res.json({ ok: true, time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Auth Routes ─────────────────────────────────────────────────────────────

// Register with email/password
app.post('/api/auth/register', async (req, res) => {
  const { email, password, risk_tolerance } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const userRecord = await admin.auth().createUser({ email, password });
    const user = await ensureUserRecord(email);
    if (typeof risk_tolerance === 'number') {
      await db.collection('users').doc(user.id).update({ risk_tolerance });
      user.risk_tolerance = risk_tolerance;
    }
    res.status(201).json({ message: 'User registered', firebaseUid: userRecord.uid, user });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

// Login with email/password
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const user = await ensureUserRecord(userRecord.email);
    const jwtToken = jwt.sign({ uid: userRecord.uid, email: userRecord.email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Login successful', token: jwtToken, user });
  } catch (err) {
    console.error(err.stack);
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Google sign-in verification
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'ID token is required' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const user = await ensureUserRecord(decoded.email);
    const jwtToken = jwt.sign({ uid: decoded.uid, email: decoded.email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Google login successful', token: jwtToken, user });
  } catch (err) {
    console.error(err.stack);
    res.status(401).json({ error: 'Invalid Google ID token' });
  }
});

// Forgot password
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  try {
    const user = await getUserByEmail(email);
    if (!user) return res.json({ message: 'If the email exists, a reset link will be sent' });
    const resetToken = jwt.sign({ email, purpose: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
    resetTokens.set(resetToken, { email, createdAt: Date.now() });
    console.log(`Password reset token for ${email}: ${resetToken}`);
    res.json({ message: 'If the email exists, a reset link will be sent', token: resetToken });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: 'Failed to process password reset' });
  }
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.purpose !== 'reset') return res.status(400).json({ error: 'Invalid reset token' });
    if (!resetTokens.has(token)) return res.status(400).json({ error: 'Token has expired or been used' });
    const userRecord = await admin.auth().getUserByEmail(decoded.email);
    await admin.auth().updateUser(userRecord.uid, { password });
    resetTokens.delete(token);
    res.json({ message: 'Password reset successful' });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    console.error(err.stack);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Send email verification
app.post('/api/auth/send-verification', authenticateToken, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(400).json({ error: 'Email not found' });
    const verifyToken = jwt.sign({ email, purpose: 'verify' }, JWT_SECRET, { expiresIn: '24h' });
    verificationTokens.set(verifyToken, { email, createdAt: Date.now() });
    console.log(`Verification token for ${email}: ${verifyToken}`);
    res.json({ message: 'Verification email sent', token: verifyToken });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// Verify email
app.post('/api/auth/verify-email', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.purpose !== 'verify') return res.status(400).json({ error: 'Invalid verification token' });
    if (!verificationTokens.has(token)) return res.status(400).json({ error: 'Token has expired or been used' });
    const userRecord = await admin.auth().getUserByEmail(decoded.email);
    await admin.auth().updateUser(userRecord.uid, { emailVerified: true });
    const userDoc = await getUserByEmail(decoded.email);
    if (userDoc) await db.collection('users').doc(userDoc.id).update({ email_verified: true });
    verificationTokens.delete(token);
    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    console.error(err.stack);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Token refresh
app.post('/api/auth/refresh', authenticateToken, async (req, res) => {
  try {
    const { email, uid } = req.user || {};
    if (!email || !uid) return res.status(400).json({ error: 'Invalid token data' });
    const newToken = jwt.sign({ uid, email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token: newToken, message: 'Token refreshed successfully' });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// ── User CRUD ───────────────────────────────────────────────────────────────

app.post('/api/users', authenticateToken, async (req, res) => {
  const { email, risk_tolerance } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const data = {
      email,
      risk_tolerance: risk_tolerance || 0.5,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection('users').add(data);
    res.status(201).json({ id: ref.id, ...data });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', authenticateToken, async (_req, res) => {
  try {
    const snap = await db.collection('users').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const user = await getUserByEmail(req.user?.email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    const docSnap = await db.collection('users').doc(req.params.id).get();
    if (!docSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = { id: docSnap.id, ...docSnap.data() };
    if (req.user?.email && user.email !== req.user.email) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(user);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', authenticateToken, async (req, res) => {
  const { email, risk_tolerance } = req.body;
  try {
    const ref = db.collection('users').doc(req.params.id);
    const docSnap = await ref.get();
    if (!docSnap.exists) return res.status(404).json({ error: 'User not found' });
    const updates = { email, risk_tolerance, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    await ref.update(updates);
    res.json({ id: req.params.id, ...docSnap.data(), ...updates });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    const ref = db.collection('users').doc(req.params.id);
    const docSnap = await ref.get();
    if (!docSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = { id: docSnap.id, ...docSnap.data() };
    await ref.delete();
    res.json({ message: 'User deleted', user });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── Portfolio CRUD ──────────────────────────────────────────────────────────

app.post('/api/portfolios', authenticateToken, async (req, res) => {
  const { user_id, stock_symbol, quantity, purchase_price } = req.body;
  if (!user_id || !stock_symbol || !quantity) {
    return res.status(400).json({ error: 'user_id, stock_symbol, and quantity are required' });
  }
  try {
    const data = {
      user_id,
      stock_symbol,
      quantity,
      purchase_price: purchase_price || 0,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection('portfolios').add(data);
    res.status(201).json({ id: ref.id, ...data });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── Nudge & Alert CRUD ──────────────────────────────────────────────────────

app.get('/api/nudges', authenticateToken, async (req, res) => {
  try {
    const snap = await db.collection('nudges')
      .where('user_id', '==', req.user.uid)
      .orderBy('created_at', 'desc')
      .limit(20)
      .get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/nudges', authenticateToken, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  try {
    const data = {
      user_id: req.user.uid,
      message,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection('nudges').add(data);
    res.status(201).json({ id: ref.id, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/alerts', authenticateToken, async (req, res) => {
  try {
    const snap = await db.collection('alerts')
      .where('user_id', '==', req.user.uid)
      .orderBy('created_at', 'desc')
      .limit(20)
      .get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts', authenticateToken, async (req, res) => {
  const { stock_symbol, trigger_price, message } = req.body;
  if (!stock_symbol || !trigger_price) {
    return res.status(400).json({ error: 'stock_symbol and trigger_price are required' });
  }
  try {
    const data = {
      user_id: req.user.uid,
      stock_symbol,
      trigger_price,
      message: message || `Alert for ${stock_symbol} at $${trigger_price}`,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection('alerts').add(data);
    res.status(201).json({ id: ref.id, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Onboarding ──────────────────────────────────────────────────────────────

app.post('/api/onboarding', authenticateToken, async (req, res) => {
  try {
    const email = req.user?.email;
    const { riskLevel, answers = [], tickers = DEFAULT_ONBOARDING_TICKERS } = req.body || {};
    if (!riskLevel) return res.status(400).json({ error: 'riskLevel is required' });
    const user = await ensureUserRecord(email, riskLevel);
    const riskTolerance = mapRiskLevelToTolerance(riskLevel);
    const normalizedAnswers = Array.isArray(answers) ? answers : [];
    const profile = { riskLevel, answeredAt: new Date().toISOString(), questionCount: normalizedAnswers.length };
    const updates = {
      risk_tolerance: riskTolerance,
      risk_level: riskLevel,
      risk_profile: profile,
      risk_answers: normalizedAnswers,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(user.id).update(updates);
    const serviceToken = jwt.sign({ service: 'backend' }, JWT_SECRET, { expiresIn: '15m' });
    let recommendation = null;
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/portfolio`, {
        tickers: Array.isArray(tickers) && tickers.length ? tickers : DEFAULT_ONBOARDING_TICKERS,
        risk_tolerance: riskLevel.toLowerCase(),
      }, { headers: { Authorization: `Bearer ${serviceToken}` }, timeout: 10000 });
      recommendation = response.data;
    } catch (aiError) {
      console.error('Onboarding portfolio recommendation failed:', aiError.message);
    }
    res.json({ user: { id: user.id, ...updates }, recommendation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { app, db, ensureUserRecord, getUserByEmail, authenticateToken, JWT_SECRET, AI_SERVICE_URL, DEFAULT_ONBOARDING_TICKERS };
