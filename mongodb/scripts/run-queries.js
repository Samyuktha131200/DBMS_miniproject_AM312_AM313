'use strict';

/**
 * Runs the demo queries against the database and prints, for each one,
 * what it is for, the exact query, and the result.
 *
 *   npm run queries                    # all find + aggregate demos
 *   npm run queries -- news2-board     # one demo by id
 *   npm run queries -- --explain       # also show which index each query used
 *   npm run queries -- --updates       # also run the insert/update/delete demos (changes data!)
 *   npm run queries -- --list          # list demo ids
 *
 * After --updates, restore the sample data with:  npm run seed -- --reset
 */

const { demos, resolveRefs, WRITE_TYPES } = require('../lib/demos');
const { pretty, summarizePlan } = require('../lib/format');
const { loadEnv, getConfig, redactUri, requireDriver } = require('../lib/config');

/** Resolve run-time placeholders (e.g. the _id of "the draft note for case 5"). */
const resolver = (db) => async (ref) => {
  const doc = await db.collection(ref.collection).findOne(ref.filter, { projection: { _id: 1 } });
  if (!doc) throw new Error(`No document in ${ref.collection} matches ${JSON.stringify(ref.filter)} (reseed?)`);
  return doc._id;
};

/** Run one demo; returns { result, plan? }. */
async function runDemo(db, demo, { explain = false } = {}) {
  const query = await resolveRefs(demo.build(), resolver(db));
  const coll = db.collection(query.collection);
  const out = { query };

  if (demo.type === 'find') {
    const cursor = () => coll.find(query.filter, { projection: query.projection }).sort(query.sort);
    out.result = await cursor().toArray();
    if (explain) out.plan = summarizePlan(await cursor().explain('queryPlanner'));
  } else if (demo.type === 'aggregate') {
    out.result = await coll.aggregate(query.pipeline).toArray();
    if (explain) out.plan = summarizePlan(await coll.aggregate(query.pipeline).explain('queryPlanner'));
  } else if (demo.type === 'update') {
    const show = () => db.collection(demo.show.collection).findOne(demo.show.filter, { projection: { _id: 0 } });
    out.before = await show();
    const res = await coll.updateOne(query.filter, query.update);
    out.result = { matchedCount: res.matchedCount, modifiedCount: res.modifiedCount };
    out.after = await show();
  } else if (demo.type === 'insert') {
    const res = await coll.insertOne(query.document);
    out.result = { acknowledged: res.acknowledged, insertedId: res.insertedId };
    out.after = await db.collection(demo.show.collection).findOne(demo.show.filter, { projection: { _id: 0 } });
  } else if (demo.type === 'delete') {
    const count = () => db.collection(demo.show.collection).countDocuments(demo.show.filter);
    out.before = await count();
    const res = query.many ? await coll.deleteMany(query.filter) : await coll.deleteOne(query.filter);
    out.result = { deletedCount: res.deletedCount };
    out.after = await count();
  }
  return out;
}

function printDemo(demo, out) {
  const line = '='.repeat(78);
  console.log(`\n${line}\n${demo.title}\n${line}`);
  console.log(`Purpose: ${demo.purpose}\n`);
  console.log(`Collection: ${out.query.collection}`);
  if (demo.type === 'find') {
    console.log(`Filter:     ${pretty(out.query.filter)}`);
    console.log(`Sort:       ${pretty(out.query.sort)}`);
  } else if (demo.type === 'aggregate') {
    console.log(`Pipeline (${out.query.pipeline.length} stages): ${out.query.pipeline.map((s) => Object.keys(s)[0]).join(' -> ')}`);
  } else if (demo.type === 'insert') {
    console.log(`Document:   ${pretty(out.query.document)}`);
  } else if (demo.type === 'delete') {
    console.log(`Filter: ${pretty(out.query.filter)}  (${out.query.many ? 'deleteMany' : 'deleteOne'})`);
  } else {
    console.log(`Filter: ${pretty(out.query.filter)}\nUpdate: ${pretty(out.query.update)}`);
  }
  if (out.plan) {
    const how = out.plan.indexes.length ? `index ${out.plan.indexes.join(', ')}` : 'no index';
    console.log(`Plan:       ${how}${out.plan.collectionScan ? ' (includes a COLLSCAN)' : ''}`);
  }
  if (demo.type === 'update') {
    console.log(`\nResult: ${pretty(out.result)}`);
    console.log(`\nBefore:\n${pretty(out.before)}\n\nAfter:\n${pretty(out.after)}`);
  } else if (demo.type === 'insert') {
    console.log(`\nResult: ${pretty(out.result)}\n\nStored document:\n${pretty(out.after)}`);
  } else if (demo.type === 'delete') {
    console.log(`\nResult: ${pretty(out.result)}\nMatching ${demo.show.collection} documents: ${out.before} before, ${out.after} after`);
  } else {
    const count = Array.isArray(out.result) ? out.result.length : 1;
    console.log(`\nResult (${count} document${count === 1 ? '' : 's'}):\n${pretty(out.result)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const d of demos) console.log(`${d.id.padEnd(18)} ${d.type.padEnd(10)} ${d.title}`);
    return;
  }
  const explain = args.includes('--explain');
  const withUpdates = args.includes('--updates') || args.includes('--writes');
  const isWrite = (d) => WRITE_TYPES.includes(d.type);
  const ids = args.filter((a) => !a.startsWith('--'));
  const unknown = ids.filter((id) => !demos.some((d) => d.id === id));
  if (unknown.length) throw new Error(`Unknown demo id(s): ${unknown.join(', ')}. Use --list.`);

  const selected = demos.filter((d) =>
    ids.length ? ids.includes(d.id) : !isWrite(d) || withUpdates,
  );
  if (selected.some(isWrite) && !withUpdates) {
    throw new Error('Insert/update/delete demos change data. Add --updates to confirm (then run `npm run seed -- --reset`).');
  }

  loadEnv();
  const { uri, dbName } = getConfig();
  const { MongoClient } = requireDriver();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connecting to ${redactUri(uri)} (database "${dbName}")...`);
  await client.connect();
  try {
    const db = client.db(dbName);
    for (const demo of selected) printDemo(demo, await runDemo(db, demo, { explain }));
    if (selected.some(isWrite)) {
      console.log('\nData was changed. Restore the sample data with: npm run seed -- --reset');
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Query run failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { runDemo };
