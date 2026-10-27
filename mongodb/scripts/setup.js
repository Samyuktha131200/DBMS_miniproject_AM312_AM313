'use strict';

/**
 * Creates the MongoDB collections with their validators and indexes.
 * Safe to run more than once: existing collections get their validator
 * updated (collMod) instead of failing, and existing indexes are left alone.
 *
 *   npm run setup
 */

const { COLLECTIONS } = require('../schema');
const { loadEnv, getConfig, redactUri, requireDriver } = require('../lib/config');

const VALIDATION_OPTIONS = { validationLevel: 'strict', validationAction: 'error' };

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<Array<{name:string, action:'created'|'updated', indexes:string[]}>>}
 */
async function setupDatabase(db, { log = console.log } = {}) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  const summary = [];

  for (const { name, schema, indexes } of COLLECTIONS) {
    const options = { validator: { $jsonSchema: schema }, ...VALIDATION_OPTIONS };
    let action;
    if (existing.has(name)) {
      await db.command({ collMod: name, ...options });
      action = 'updated';
    } else {
      await db.createCollection(name, options);
      action = 'created';
    }

    let indexNames = [];
    try {
      indexNames = await db.collection(name).createIndexes(indexes);
    } catch (err) {
      // 85 IndexOptionsConflict / 86 IndexKeySpecsConflict: an index with the
      // same name or key but different options already exists
      if (err && (err.code === 85 || err.code === 86)) {
        throw new Error(
          `Index conflict on "${name}": ${err.message}\n` +
            `An older version of this index exists. Drop it in mongosh with\n` +
            `  db.${name}.dropIndex("<index name>")\nand run setup again.`,
        );
      }
      throw err;
    }

    log(`${action === 'created' ? 'Created' : 'Updated'} ${name}: validator + ${indexNames.length} indexes (${indexNames.join(', ')})`);
    summary.push({ name, action, indexes: indexNames });
  }
  return summary;
}

async function main() {
  loadEnv();
  const { uri, dbName } = getConfig();
  const { MongoClient } = requireDriver();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });

  console.log(`Connecting to ${redactUri(uri)} (database "${dbName}")...`);
  await client.connect();
  try {
    await setupDatabase(client.db(dbName));
    console.log('Setup complete.');
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Setup failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { setupDatabase, VALIDATION_OPTIONS };
