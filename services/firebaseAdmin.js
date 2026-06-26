const legacyAdmin = require('firebase-admin');

const hasLegacySurface = typeof legacyAdmin.firestore === 'function'
  && typeof legacyAdmin.auth === 'function'
  && legacyAdmin.credential;

if (hasLegacySurface) {
  const legacyHasApps = () => Array.isArray(legacyAdmin.apps) && legacyAdmin.apps.length > 0;
  module.exports = {
    ...legacyAdmin,
    hasApps: legacyHasApps,
  };
} else if (process.env.NODE_ENV === 'test') {
  const fail = async () => {
    throw new Error('Firebase test stub is not configured for this operation');
  };
  const query = {
    where() { return this; },
    orderBy() { return this; },
    limit() { return this; },
    get: fail,
    add: fail,
    doc() {
      return {
        get: fail,
        set: fail,
        update: fail,
        delete: fail,
      };
    },
  };
  const firestore = () => ({
    collection: () => query,
  });
  firestore.FieldValue = { serverTimestamp: () => new Date() };
  firestore.Timestamp = { fromMillis: (millis) => ({ toMillis: () => millis }) };

  module.exports = {
    auth: () => ({
      createUser: fail,
      verifyIdToken: fail,
      getUserByEmail: fail,
      updateUser: fail,
    }),
    credential: { cert: (serviceAccount) => serviceAccount },
    firestore,
    hasApps: () => true,
    initializeApp: () => ({}),
  };
} else {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

  const firestore = () => getFirestore();
  firestore.FieldValue = FieldValue;
  firestore.Timestamp = Timestamp;

  module.exports = {
    auth: () => getAuth(),
    credential: { cert },
    firestore,
    hasApps: () => getApps().length > 0,
    initializeApp,
  };
}
