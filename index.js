// Initializing Express, PostgreSQL, Firebase Admin, and JWT for the backend
const express = require('express');
const { Pool } = require('pg');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const predictionsRouter = require('./routes/predictions');
const app = express();
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccount = require('./aivestor-firebase-adminsdk.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// PostgreSQL connection configuration
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'investment_advisor',
  password: 'password',
  port: 5432,
});

// JWT Secret (use a strong secret in production; this is for demo purposes)
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secure-secret-key'; 

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expect "Bearer <token>"
  if (!token) return res.status(401).json({ error: 'Access denied, no token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// Root endpoint
app.get('/', (req, res) => res.send('Aivestor Backend API'));

// Add predictions routes
app.use('/api', predictionsRouter);

// Test database connection (public endpoint)
app.get('/api/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: 'Database connected', time: result.rows[0].now });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// User registration (Email/Password)
app.post('/api/auth/register', async (req, res) => {
  const { email, password, risk_tolerance } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });

    const result = await pool.query(
      'INSERT INTO users (email, risk_tolerance) VALUES ($1, $2) RETURNING *',
      [email, risk_tolerance || 0.5]
    );

    res.status(201).json({
      message: 'User registered',
      firebaseUid: userRecord.uid,
      user: result.rows[0],
    });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

// User login (Email/Password)
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    // Generate JWT from custom token
    const jwtToken = jwt.sign({ uid: userRecord.uid, email: userRecord.email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Login successful', token: jwtToken });
  } catch (err) {
    console.error(err.stack);
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Google Sign-In verification
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'ID token is required' });
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email;

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    let user;
    if (userResult.rows.length === 0) {
      const result = await pool.query(
        'INSERT INTO users (email, risk_tolerance) VALUES ($1, $2) RETURNING *',
        [email, 0.5]
      );
      user = result.rows[0];
    } else {
      user = userResult.rows[0];
    }

    const jwtToken = jwt.sign({ uid: firebaseUid, email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({
      message: 'Google login successful',
      token: jwtToken,
      user,
    });
  } catch (err) {
    console.error(err.stack);
    res.status(401).json({ error: 'Invalid Google ID token' });
  }
});

// Secure CRUD for Users
app.post('/api/users', authenticateToken, async (req, res) => {
  const { email, risk_tolerance } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO users (email, risk_tolerance) VALUES ($1, $2) RETURNING *',
      [email, risk_tolerance || 0.5]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { email, risk_tolerance } = req.body;
  try {
    const result = await pool.query(
      'UPDATE users SET email = $1, risk_tolerance = $2 WHERE id = $3 RETURNING *',
      [email, risk_tolerance, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted', user: result.rows[0] });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

// Secure CRUD for Portfolios
app.post('/api/portfolios', authenticateToken, async (req, res) => {
  const { user_id, stock_symbol, quantity, purchase_price } = req.body;
  if (!user_id || !stock_symbol || !quantity) {
    return res.status(400).json({ error: 'user_id, stock_symbol, and quantity are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO portfolios (user_id, stock_symbol, quantity, purchase_price) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id, stock_symbol, quantity, purchase_price || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/portfolios/user/:user_id', authenticateToken, async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM portfolios WHERE user_id = $1', [user_id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/portfolios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { stock_symbol, quantity, purchase_price } = req.body;
  try {
    const result = await pool.query(
      'UPDATE portfolios SET stock_symbol = $1, quantity = $2, purchase_price = $3 WHERE id = $4 RETURNING *',
      [stock_symbol, quantity, purchase_price, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Portfolio entry not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/portfolios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM portfolios WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Portfolio entry not found' });
    }
    res.json({ message: 'Portfolio entry deleted', portfolio: result.rows[0] });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => console.log('Server running on port 5000'));

process.on('SIGTERM', () => pool.end());