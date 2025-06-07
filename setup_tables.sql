CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  risk_tolerance DECIMAL(3,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE portfolios (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  stock_symbol VARCHAR(10) NOT NULL,
  quantity INTEGER NOT NULL,
  purchase_price DECIMAL(10,2)
);

CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  stock_symbol VARCHAR(10),
  trigger_price DECIMAL(10,2),
  message TEXT,
  sent_at TIMESTAMP
);

CREATE TABLE nudges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE brokerage_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  brokerage_name VARCHAR(50),
  access_token VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);