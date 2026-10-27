'use strict';

/**
 * A small in-memory stand-in for the driver's Db, enough to unit-test
 * lib/repository.js without a MongoDB server:
 *   - insertOne runs the collection's $jsonSchema validator (error 121)
 *     and the unique indexes from schema/indexes.js (error 11000)
 *   - filters: equality (incl. array membership and nested objects),
 *     $ne, $in, $lt, $lte, $gt, $gte, $regex
 *   - updates: $set, $push (+ $each), $inc, $max, upsert
 *   - startSession() behaves like a standalone server (no transactions)
 * Pipeline-style updates are not supported (U3 amend is covered by the
 * builder tests and the integration tests).
 */

const { validate } = require('./json-schema');
const { validators, indexes } = require('../../schema');

let nextId = 1;
class FakeObjectId {
  constructor() { this._bsontype = 'ObjectId'; this.id = (nextId++).toString(16).padStart(24, '0'); }
  toString() { return this.id; }
  toHexString() { return this.id; }
}

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);

function equal(a, b) {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  // structuredClone drops the class, so compare the hex id field, not toString()
  if (a && b && a._bsontype && b._bsontype) return a.id === b.id;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a); const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => equal(a[k], b[k]));
  }
  return a === b;
}

const isOperatorObject = (c) => c && typeof c === 'object' && !Array.isArray(c) && !(c instanceof Date) && !c._bsontype
  && Object.keys(c).length > 0 && Object.keys(c).every((k) => k.startsWith('$'));

function valueMatches(v, cond) {
  if (isOperatorObject(cond)) {
    return Object.entries(cond).every(([op, x]) => {
      const num = (y) => (y instanceof Date ? y.getTime() : y);
      switch (op) {
        case '$ne': return !valueMatches(v, x);
        case '$eq': return valueMatches(v, x);
        case '$in': return x.some((y) => valueMatches(v, y));
        case '$lt': return v !== undefined && num(v) < num(x);
        case '$lte': return v !== undefined && num(v) <= num(x);
        case '$gt': return v !== undefined && num(v) > num(x);
        case '$gte': return v !== undefined && num(v) >= num(x);
        case '$regex': return typeof v === 'string' && new RegExp(x).test(v);
        default: throw new Error(`fake-db: unsupported operator ${op}`);
      }
    });
  }
  if (Array.isArray(v) && !Array.isArray(cond)) return v.some((item) => equal(item, cond));
  return equal(v, cond);
}

const matches = (filter, doc) => Object.entries(filter).every(([k, c]) => valueMatches(get(doc, k), c));

function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) { if (o[k] == null) o[k] = {}; o = o[k]; }
  o[keys.at(-1)] = value;
}

function applyUpdate(doc, update) {
  if (Array.isArray(update)) throw new Error('fake-db: pipeline updates not supported');
  for (const [op, spec] of Object.entries(update)) {
    for (const [path, val] of Object.entries(spec)) {
      const cur = get(doc, path);
      if (op === '$set') setPath(doc, path, structuredClone(val));
      else if (op === '$inc') setPath(doc, path, (cur ?? 0) + val);
      else if (op === '$max') setPath(doc, path, cur === undefined || val > cur ? val : cur);
      else if (op === '$push') {
        const items = val && val.$each ? val.$each : [val];
        setPath(doc, path, [...(cur ?? []), ...structuredClone(items)]);
      } else throw new Error(`fake-db: unsupported update ${op}`);
    }
  }
}

function sortDocs(docs, sort = {}) {
  const keys = Object.entries(sort).filter(([, d]) => typeof d === 'number');
  return docs.sort((a, b) => {
    for (const [k, dir] of keys) {
      let x = get(a, k); let y = get(b, k);
      if (x instanceof Date) x = x.getTime();
      if (y instanceof Date) y = y.getTime();
      if (x === y) continue;
      return (x < y ? -1 : 1) * dir;
    }
    return 0;
  });
}

function project(doc, projection) {
  if (!projection || Object.keys(projection).length === 0) return structuredClone(doc);
  const include = Object.entries(projection).filter(([, v]) => v === 1);
  if (include.length) {
    const out = {};
    if (projection._id !== 0) out._id = doc._id;
    for (const [k] of include) if (get(doc, k) !== undefined) setPath(out, k, structuredClone(get(doc, k)));
    return out;
  }
  const out = structuredClone(doc);
  for (const [k, v] of Object.entries(projection)) if (v === 0) delete out[k];
  return out;
}

class FakeCollection {
  constructor(db, name) { this.db = db; this.name = name; this.docs = []; }

  /** `self` is the stored document being replaced (for updates), so it is not compared with itself. */
  checkInsert(doc, self = doc) {
    const schema = validators[this.name];
    if (schema) {
      const details = validate(schema, doc);
      if (details.length) throw Object.assign(new Error('Document failed validation'), { code: 121, errInfo: { details } });
    }
    for (const idx of indexes[this.name] ?? []) {
      if (!idx.unique) continue;
      const keys = Object.keys(idx.key);
      const clash = this.docs.find((d) => d !== self && keys.every((k) => equal(get(d, k), get(doc, k))));
      if (clash) {
        throw Object.assign(new Error('E11000 duplicate key error'), {
          code: 11000, keyValue: Object.fromEntries(keys.map((k) => [k, get(doc, k)])),
        });
      }
    }
    if (doc._id !== undefined && this.docs.some((d) => d !== self && equal(d._id, doc._id))) {
      throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000, keyValue: { _id: doc._id } });
    }
  }

  async insertOne(doc) {
    const stored = { _id: doc._id ?? new FakeObjectId(), ...structuredClone(doc) };
    this.checkInsert(stored);
    this.docs.push(stored);
    return { acknowledged: true, insertedId: stored._id };
  }

  find(filter = {}, { projection } = {}) {
    let sort = {}; let limit = Infinity;
    const cursor = {
      sort: (s) => { sort = s || {}; return cursor; },
      limit: (n) => { limit = n; return cursor; },
      toArray: async () => sortDocs(this.docs.filter((d) => matches(filter, d)), sort).slice(0, limit).map((d) => project(d, projection)),
    };
    return cursor;
  }

  async findOne(filter = {}, { projection } = {}) {
    const d = this.docs.find((x) => matches(filter, x));
    return d ? project(d, projection) : null;
  }

  async countDocuments(filter = {}) { return this.docs.filter((d) => matches(filter, d)).length; }

  async updateOne(filter, update, { upsert = false } = {}) {
    const doc = this.docs.find((d) => matches(filter, d));
    if (!doc) {
      if (!upsert) return { matchedCount: 0, modifiedCount: 0 };
      const fresh = {};
      for (const [k, v] of Object.entries(filter)) if (!isOperatorObject(v)) setPath(fresh, k, v);
      applyUpdate(fresh, update);
      if (fresh._id === undefined) fresh._id = new FakeObjectId();
      this.checkInsert(fresh);
      this.docs.push(fresh);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    const before = structuredClone(doc);
    const candidate = structuredClone(doc);
    applyUpdate(candidate, update);
    this.checkInsert(candidate, doc);
    Object.assign(doc, candidate);
    return { matchedCount: 1, modifiedCount: equal(before, doc) ? 0 : 1 };
  }

  async findOneAndUpdate(filter, update, { returnDocument = 'before', upsert = false } = {}) {
    const before = await this.findOne(filter);
    const res = await this.updateOne(filter, update, { upsert });
    if (!res.matchedCount && !res.upsertedCount) return null;
    return returnDocument === 'after' ? this.findOne(before ? { _id: before._id } : filter) : before;
  }

  async deleteOne(filter) {
    const i = this.docs.findIndex((d) => matches(filter, d));
    if (i < 0) return { deletedCount: 0 };
    this.docs.splice(i, 1);
    return { deletedCount: 1 };
  }

  async deleteMany(filter) {
    const keep = this.docs.filter((d) => !matches(filter, d));
    const n = this.docs.length - keep.length;
    this.docs = keep;
    return { deletedCount: n };
  }

  aggregate() { throw new Error('fake-db: aggregate not supported (covered by mini-agg / integration tests)'); }
}

class FakeDb {
  constructor(databaseName = 'fake') {
    this.databaseName = databaseName;
    this.collections = new Map();
    this.client = {
      // a standalone server: MongoDB refuses transactions with IllegalOperation (20)
      startSession: () => ({
        withTransaction: async () => {
          throw Object.assign(new Error('Transaction numbers are only allowed on a replica set member or mongos'), { code: 20 });
        },
        endSession: async () => {},
      }),
    };
  }

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection(this, name));
    return this.collections.get(name);
  }

  /** Load documents as-is (like seed), giving each an _id. */
  load(name, docs) {
    const c = this.collection(name);
    c.docs.push(...structuredClone(docs).map((d) => ({ _id: new FakeObjectId(), ...d })));
    return this;
  }
}

module.exports = { FakeDb, FakeObjectId, matches };
