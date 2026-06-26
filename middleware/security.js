const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { config } = require('../config/env');

const isOriginAllowed = (origin) => !origin || config.allowedCorsOrigins.includes(origin);

const corsOptions = {
  origin(origin, callback) {
    callback(null, isOriginAllowed(origin));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

const socketCorsOptions = {
  origin(origin, callback) {
    callback(null, isOriginAllowed(origin));
  },
  credentials: true,
};

const securityHeaders = helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
});

const apiRateLimiter = rateLimit({
  windowMs: config.apiRateLimitWindowMs,
  limit: config.apiRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const authRateLimiter = rateLimit({
  windowMs: config.authRateLimitWindowMs,
  limit: config.authRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

module.exports = {
  apiRateLimiter,
  authRateLimiter,
  corsOptions,
  isOriginAllowed,
  securityHeaders,
  socketCorsOptions,
};
