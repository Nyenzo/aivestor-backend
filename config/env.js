require('dotenv').config();

const UNSAFE_JWT_SECRETS = new Set([
  'test-secret',
  'test-secret-key-for-ci',
  'your-very-secure-secret-key',
]);

const isTest = process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';

const parseList = (value = '') => value
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const getJwtSecret = () => {
  const configured = process.env.JWT_SECRET;
  if (configured) {
    if (isProduction && (configured.length < 32 || UNSAFE_JWT_SECRETS.has(configured))) {
      throw new Error('JWT_SECRET must be at least 32 characters and must not use a default value in production');
    }
    return configured;
  }

  if (isTest) return 'test-secret';
  if (isProduction) throw new Error('JWT_SECRET is required in production');

  return 'dev-only-jwt-secret-change-before-prod-32';
};

const getAllowedCorsOrigins = () => {
  const configured = parseList([
    process.env.CORS_ORIGIN,
    process.env.ALLOWED_ORIGINS,
    process.env.FRONTEND_URL,
  ].filter(Boolean).join(','));

  if (configured.some((origin) => origin === '*')) {
    throw new Error('Wildcard CORS origins are not allowed');
  }

  if (isProduction && configured.length === 0) {
    throw new Error('CORS_ORIGIN or ALLOWED_ORIGINS is required in production');
  }

  if (configured.length > 0) {
    return Array.from(new Set(configured));
  }

  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
  ];
};

const requiredInProduction = (name) => {
  const value = process.env[name];
  if (isProduction && !value) {
    throw new Error(`${name} is required in production`);
  }
  return value;
};

const config = {
  isProduction,
  isTest,
  port: Number(process.env.PORT || 5000),
  jwtSecret: getJwtSecret(),
  allowedCorsOrigins: getAllowedCorsOrigins(),
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:5001',
  firebaseWebApiKey: process.env.FIREBASE_WEB_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '256kb',
  authRateLimitWindowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  apiRateLimitWindowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  apiRateLimitMax: Number(process.env.API_RATE_LIMIT_MAX || 180),
  tokenStore: process.env.TOKEN_STORE || (isProduction ? 'firestore' : 'memory'),
  finnhubApiKey: requiredInProduction('FINNHUB_API_KEY'),
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  firebaseServiceAccountB64: process.env.FIREBASE_SERVICE_ACCOUNT_B64,
};

if (isProduction && !config.firebaseServiceAccountJson && !config.firebaseServiceAccountB64) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_B64 is required in production');
}

module.exports = { config };
