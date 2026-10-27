'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DB_NAME = 'hospital_emergency_management';

/**
 * Load mongodb/.env if it exists. Variables already set in the shell win,
 * because process.loadEnvFile() does not overwrite existing values.
 * Needs Node.js 20.12+ (process.loadEnvFile).
 */
function loadEnv(envPath = path.join(__dirname, '..', '.env')) {
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}

/** Read connection settings from environment variables. Never hard-coded. */
function getConfig(env = process.env) {
  const uri = env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Copy mongodb/.env.example to mongodb/.env and fill it in, ' +
        'or export MONGODB_URI in your shell.',
    );
  }
  return { uri, dbName: env.MONGODB_DB || DEFAULT_DB_NAME };
}

/** Hide credentials before a URI is ever printed: mongodb://user:pass@h -> mongodb://***@h */
function redactUri(uri) {
  return uri.replace(/\/\/[^@/]*@/, '//***@');
}

/** Load the MongoDB driver with a clear message if `npm install` was skipped. */
function requireDriver() {
  try {
    return require('mongodb');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error('The "mongodb" package is not installed. Run `npm install` in the mongodb/ folder first.');
    }
    throw err;
  }
}

module.exports = { DEFAULT_DB_NAME, loadEnv, getConfig, redactUri, requireDriver };
