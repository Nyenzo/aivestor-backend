const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

// PostgreSQL connection configuration
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'investment_advisor',
  password: 'password', // Replace with your password
  port: 5432,
});

// Test endpoint to check database connection
app.get('/api/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: 'Database connected', time: result.rows[0].now });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Root endpoint
app.get('/', (req, res) => res.send('Aivestor Backend API'));

app.listen(5000, () => console.log('Server running on port 5000'));

// Close pool on process exit
process.on('SIGTERM', () => pool.end());