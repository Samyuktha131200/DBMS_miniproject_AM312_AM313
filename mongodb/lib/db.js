'use strict';

/**
 * One shared MongoClient for the whole app.
 *
 * Next.js route handlers run in a long-lived Node process, so the client is
 * created once and reused (the driver keeps its own connection pool).
 * In development Next.js reloads modules on every change, so the client is
 * cached on globalThis; otherwise each reload would open a new pool.
 *
 *   const { getDb } = require('<path>/mongodb/lib/db');
 *   const db = await getDb();
 *
 * Settings come from environment variables only (MONGODB_URI, MONGODB_DB),
 * e.g. from .env.local in the Next.js app. Nothing is hard-coded.
 */

const { getConfig, loadEnv, requireDriver } = require('./config');

const CACHE_KEY = Symbol.for('hospital_er.mongodb.client');

/** @returns {Promise<import('mongodb').MongoClient>} */
function getClient() {
  if (!globalThis[CACHE_KEY]) {
    loadEnv();
    const { uri } = getConfig();
    const { MongoClient } = requireDriver();
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      appName: 'hospital-er-web',
    });
    globalThis[CACHE_KEY] = client.connect().catch((err) => {
      delete globalThis[CACHE_KEY]; // let the next request retry instead of caching the failure
      throw err;
    });
  }
  return globalThis[CACHE_KEY];
}

/** @returns {Promise<import('mongodb').Db>} */
async function getDb() {
  const client = await getClient();
  return client.db(getConfig().dbName);
}

/** For scripts and tests: close the shared client. */
async function closeClient() {
  const pending = globalThis[CACHE_KEY];
  delete globalThis[CACHE_KEY];
  if (pending) await (await pending).close();
}

module.exports = { getClient, getDb, closeClient };
