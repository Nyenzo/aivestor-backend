const axios = require('axios');
require('dotenv').config();

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_CACHE_TIMEOUT_MS = Number(process.env.REDIS_CACHE_TIMEOUT_MS || 1500);
const REDIS_CACHE_KEY_PREFIX = process.env.REDIS_CACHE_KEY_PREFIX || 'aivestor';
const enabled = Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);

function isEnabled() {
  return enabled;
}

function buildCacheKey(namespace, key) {
  const safeNamespace = String(namespace || 'cache').replace(/[^a-zA-Z0-9:_-]/g, ':');
  const safeKey = String(key || '').replace(/\s+/g, '').slice(0, 512);
  return `${REDIS_CACHE_KEY_PREFIX}:${safeNamespace}:${safeKey}`;
}

async function getJson(key) {
  if (!enabled || !key) return null;

  try {
    const response = await executeCommand(['GET', key]);
    if (!response.result) return null;
    return JSON.parse(response.result);
  } catch (error) {
    warnOnce('read', error);
    return null;
  }
}

async function setJson(key, value, ttlMs) {
  if (!enabled || !key || ttlMs <= 0) return false;

  try {
    await executeCommand(['SET', key, JSON.stringify(value), 'PX', Math.floor(ttlMs)]);
    return true;
  } catch (error) {
    warnOnce('write', error);
    return false;
  }
}

async function executeCommand(command) {
  const response = await axios.post(UPSTASH_REDIS_REST_URL, command, {
    timeout: REDIS_CACHE_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });

  if (response.status >= 400 || response.data?.error) {
    throw new Error(`Redis command failed with status ${response.status}`);
  }

  return response.data || {};
}

const warnedOperations = new Set();

function warnOnce(operation, error) {
  if (warnedOperations.has(operation)) return;
  warnedOperations.add(operation);
  console.warn(`Redis cache unavailable during ${operation}: ${error.message}`);
}

module.exports = {
  buildCacheKey,
  getJson,
  isEnabled,
  setJson,
};
