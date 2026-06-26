const crypto = require('crypto');
const admin = require('./firebaseAdmin');

const hashToken = (token) => crypto
  .createHash('sha256')
  .update(token)
  .digest('hex');

const now = () => Date.now();

class MemoryTokenStore {
  constructor() {
    this.tokens = new Map();
  }

  async save(type, token, payload, expiresAtMs) {
    this.tokens.set(hashToken(token), {
      type,
      payload,
      expiresAtMs,
      createdAtMs: now(),
    });
  }

  async consume(type, token) {
    const key = hashToken(token);
    const entry = this.tokens.get(key);
    if (!entry || entry.type !== type || entry.expiresAtMs <= now()) {
      this.tokens.delete(key);
      return null;
    }
    this.tokens.delete(key);
    return entry.payload;
  }
}

class FirestoreTokenStore {
  constructor(db) {
    this.collection = db.collection('auth_tokens');
  }

  async save(type, token, payload, expiresAtMs) {
    await this.collection.doc(hashToken(token)).set({
      type,
      payload,
      expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  async consume(type, token) {
    const ref = this.collection.doc(hashToken(token));
    const snap = await ref.get();
    if (!snap.exists) return null;

    const data = snap.data();
    const expiresAtMs = data.expiresAt?.toMillis?.() || 0;
    if (data.type !== type || expiresAtMs <= now()) {
      await ref.delete();
      return null;
    }

    await ref.delete();
    return data.payload || null;
  }
}

const createTokenStore = ({ db, mode }) => {
  if (mode === 'firestore') return new FirestoreTokenStore(db);
  return new MemoryTokenStore();
};

module.exports = { createTokenStore, hashToken, MemoryTokenStore, FirestoreTokenStore };
