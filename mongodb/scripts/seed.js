'use strict';

/**
 * Loads the sample documents from mongodb/data/ into the database.
 * Run setup first so the validators check every document on insert.
 *
 *   npm run seed            # skips any collection that already has documents
 *   npm run seed -- --reset # deletes existing documents first, then inserts
 */

const path = require('node:path');
const { COLLECTION_NAMES } = require('../schema');
const { loadEnv, getConfig, redactUri, requireDriver } = require('../lib/config');
const { loadJsonDocuments } = require('../lib/load-json');

const DATA_DIR = path.join(__dirname, '..', 'data');

/** Print why MongoDB's validator rejected a document (error code 121). */
function describeInsertError(err, collection) {
  const writeErrors = err.writeErrors
    ? [].concat(err.writeErrors)
    : err.code === 121
      ? [err]
      : [];
  if (writeErrors.length === 0) return err.message;
  return writeErrors
    .map((we) => {
      const index = we.index !== undefined ? ` (document #${we.index} in ${collection}.json)` : '';
      const info = we.errInfo ? `\n${JSON.stringify(we.errInfo, null, 2)}` : '';
      return `${we.errmsg || we.message}${index}${info}`;
    })
    .join('\n');
}

/**
 * @param {import('mongodb').Db} db
 * @param {{reset?: boolean, dataDir?: string, log?: Function}} options
 */
async function seedDatabase(db, { reset = false, dataDir = DATA_DIR, log = console.log } = {}) {
  const summary = [];
  for (const name of Object.values(COLLECTION_NAMES)) {
    const docs = loadJsonDocuments(path.join(dataDir, `${name}.json`));
    const collection = db.collection(name);
    const existing = await collection.countDocuments({});

    if (existing > 0 && !reset) {
      log(`Skipped ${name}: already has ${existing} documents (use --reset to reload)`);
      summary.push({ name, inserted: 0, skipped: true });
      continue;
    }
    if (reset && existing > 0) {
      const { deletedCount } = await collection.deleteMany({});
      log(`Cleared ${name}: deleted ${deletedCount} documents`);
    }

    try {
      const { insertedCount } = await collection.insertMany(docs, { ordered: true });
      log(`Seeded ${name}: inserted ${insertedCount} documents`);
      summary.push({ name, inserted: insertedCount, skipped: false });
    } catch (err) {
      throw new Error(`Inserting into ${name} failed:\n${describeInsertError(err, name)}`);
    }
  }
  return summary;
}

async function main() {
  loadEnv();
  const { uri, dbName } = getConfig();
  const reset = process.argv.includes('--reset');
  const { MongoClient } = requireDriver();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });

  console.log(`Connecting to ${redactUri(uri)} (database "${dbName}")...`);
  await client.connect();
  try {
    await seedDatabase(client.db(dbName), { reset });
    console.log('Seeding complete.');
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Seeding failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { seedDatabase, describeInsertError, DATA_DIR };
