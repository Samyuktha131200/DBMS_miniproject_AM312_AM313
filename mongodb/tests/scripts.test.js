'use strict';

/**
 * Tests the setup/seed LOGIC against an in-memory fake of the driver's Db
 * object (no MongoDB server needed). The fake applies the same validators
 * using tests/helpers/json-schema.js. Real server behaviour is covered by
 * the integration tests that run against a local MongoDB.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { setupDatabase } = require('../scripts/setup');
const { seedDatabase, describeInsertError } = require('../scripts/seed');
const { getConfig, redactUri, DEFAULT_DB_NAME } = require('../lib/config');
const { reviveDates } = require('../lib/load-json');
const { validate } = require('./helpers/json-schema');

class FakeCollection {
  constructor(db, name) { this.db = db; this.name = name; this.docs = []; this.indexes = []; }
  async createIndexes(specs) {
    if (this.db.failIndexWith) throw this.db.failIndexWith;
    this.indexes = specs;
    return specs.map((s) => s.name);
  }
  async countDocuments() { return this.docs.length; }
  async deleteMany() { const n = this.docs.length; this.docs = []; return { deletedCount: n }; }
  async insertMany(docs) {
    const schema = this.db.validators[this.name];
    docs.forEach((d, index) => {
      if (schema && validate(schema, d).length) {
        const e = new Error('Document failed validation');
        e.writeErrors = [{ index, errmsg: 'Document failed validation', errInfo: { details: validate(schema, d) } }];
        throw e;
      }
    });
    this.docs.push(...docs);
    return { insertedCount: docs.length };
  }
}

class FakeDb {
  constructor() { this.collections = new Map(); this.validators = {}; this.calls = []; }
  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection(this, name));
    return this.collections.get(name);
  }
  listCollections() {
    return { toArray: async () => [...this.collections.keys()].map((name) => ({ name })) };
  }
  async createCollection(name, options) {
    this.calls.push(['createCollection', name, options]);
    this.validators[name] = options.validator.$jsonSchema;
    return this.collection(name);
  }
  async command(cmd) {
    this.calls.push(['command', cmd]);
    if (cmd.collMod) this.validators[cmd.collMod] = cmd.validator.$jsonSchema;
    return { ok: 1 };
  }
}

const quiet = { log: () => {} };

test('setup creates all three collections with strict validators and indexes', async () => {
  const db = new FakeDb();
  const summary = await setupDatabase(db, quiet);
  assert.deepEqual(summary.map((s) => [s.name, s.action]), [
    ['incident_reports', 'created'],
    ['observation_logs', 'created'],
    ['clinical_notes', 'created'],
  ]);
  for (const [, name, options] of db.calls) {
    assert.equal(options.validationLevel, 'strict', name);
    assert.equal(options.validationAction, 'error', name);
    assert.ok(options.validator.$jsonSchema.required.length > 0, name);
  }
  assert.ok(db.collection('clinical_notes').indexes.some((i) => i.name === 'notes_text'));
});

test('running setup twice updates validators instead of failing', async () => {
  const db = new FakeDb();
  await setupDatabase(db, quiet);
  const summary = await setupDatabase(db, quiet);
  assert.ok(summary.every((s) => s.action === 'updated'));
  assert.equal(db.calls.filter(([kind, cmd]) => kind === 'command' && cmd.collMod).length, 3);
});

test('an index conflict produces a helpful message', async () => {
  const db = new FakeDb();
  db.failIndexWith = Object.assign(new Error('Index already exists with different options'), { code: 85 });
  await assert.rejects(setupDatabase(db, quiet), /dropIndex/);
});

test('seed inserts every sample document, then skips on the next run', async () => {
  const db = new FakeDb();
  await setupDatabase(db, quiet);
  const first = await seedDatabase(db, quiet);
  assert.deepEqual(first.map((s) => [s.name, s.inserted]), [
    ['incident_reports', 8],
    ['observation_logs', 32],
    ['clinical_notes', 14],
  ]);
  const second = await seedDatabase(db, quiet);
  assert.ok(second.every((s) => s.skipped));
  assert.equal(db.collection('observation_logs').docs.length, 32);
});

test('seed --reset replaces documents instead of duplicating them', async () => {
  const db = new FakeDb();
  await setupDatabase(db, quiet);
  await seedDatabase(db, quiet);
  await seedDatabase(db, { ...quiet, reset: true });
  assert.equal(db.collection('incident_reports').docs.length, 8);
  assert.equal(db.collection('clinical_notes').docs.length, 14);
});

test('seed stores timestamps as Date objects', async () => {
  const db = new FakeDb();
  await setupDatabase(db, quiet);
  await seedDatabase(db, quiet);
  const obs = db.collection('observation_logs').docs[0];
  assert.ok(obs.observed_at instanceof Date);
  assert.equal(obs.observed_at.toISOString(), '2026-10-24T02:30:00.000Z'); // 08:00 IST
});

test('validation errors are reported with the failing document', () => {
  const err = Object.assign(new Error('bulk'), {
    writeErrors: [{ index: 4, errmsg: 'Document failed validation', errInfo: { failingDocumentId: 'x' } }],
  });
  const text = describeInsertError(err, 'observation_logs');
  assert.match(text, /document #4 in observation_logs\.json/);
  assert.match(text, /failingDocumentId/);
});

test('config: MONGODB_URI is required and never hard-coded', () => {
  assert.throws(() => getConfig({}), /MONGODB_URI is not set/);
  assert.deepEqual(getConfig({ MONGODB_URI: 'mongodb://localhost:27017' }), {
    uri: 'mongodb://localhost:27017',
    dbName: DEFAULT_DB_NAME,
  });
  assert.equal(getConfig({ MONGODB_URI: 'x', MONGODB_DB: 'other' }).dbName, 'other');
});

test('config: credentials are hidden before printing', () => {
  assert.equal(
    redactUri('mongodb+srv://alice:s3cret@cluster0.example.net/?w=majority'),
    'mongodb+srv://***@cluster0.example.net/?w=majority',
  );
  assert.equal(redactUri('mongodb://localhost:27017'), 'mongodb://localhost:27017');
});

test('JSON loader converts ISO timestamps only', () => {
  const d = reviveDates('k', '2026-10-24T08:15:00+05:30');
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), '2026-10-24T02:45:00.000Z');
  assert.equal(reviveDates('k', 'Pain 8/10 since 08:00'), 'Pain 8/10 since 08:00');
  assert.equal(reviveDates('k', '2026-10-24'), '2026-10-24'); // date-only strings stay text
});
