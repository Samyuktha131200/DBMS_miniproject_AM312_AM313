'use strict';

/**
 * Data-access layer for the Next.js API (route handlers).
 *
 * Every function takes (db, user, input, options) and:
 *   1. checks the user's role may perform the action (lib/access.js) -> 403
 *   2. fills in who did it from the session (never from the request body)
 *   3. builds the query with lib/queries.js (the same builders the demos,
 *      mongosh file and docs use)
 *   4. runs it and turns MongoDB errors into HTTP-style errors:
 *        validator rejected the document (121) -> ValidationError 400
 *        duplicate key (11000)                -> ConflictError 409
 *        nothing matched an update/delete      -> NotFoundError 404
 *
 * A route handler then only has to do:
 *
 *   const db = await getDb();
 *   try {
 *     const result = await repo.recordObservation(db, session.user, body);
 *     return Response.json(result, { status: 201 });
 *   } catch (err) {
 *     const { status, body } = repo.toHttpError(err);
 *     return Response.json(body, { status });
 *   }
 *
 * `options.caseExists(caseId)` (optional, async) lets the API check the case
 * in MySQL before writing to MongoDB, keeping the two databases consistent.
 */

const q = require('./queries');
const { assertCan, actorRef, AccessDeniedError } = require('./access');
const { requireDriver } = require('./config');

const MAX_RESULTS = 500;
const DEFAULT_RETENTION_DAYS = 365;

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    if (details !== undefined) this.details = details;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
  }
}

class TransactionUnsupportedError extends Error {
  constructor() {
    super('Multi-document transactions need a replica set. Start mongod with --replSet rs0 and run rs.initiate() once (see docs/DATA_MODEL.md).');
    this.name = 'TransactionUnsupportedError';
    this.status = 501;
  }
}

/** Turn driver / builder errors into the error types above. */
function mapError(err) {
  if (err instanceof AccessDeniedError || err instanceof ValidationError
    || err instanceof NotFoundError || err instanceof ConflictError
    || err instanceof TransactionUnsupportedError) return err;
  if (err instanceof TypeError || err instanceof RangeError) return new ValidationError(err.message);
  if (err && err.code === 121) {
    return new ValidationError('Document failed database validation', err.errInfo?.details ?? err.errInfo);
  }
  if (err && err.code === 11000) {
    const key = err.keyValue ? ` (${Object.keys(err.keyValue).join(', ')})` : '';
    return new ConflictError(`A record with the same key already exists${key}`);
  }
  // 20 IllegalOperation / 263 OperationNotSupportedInTransaction on a standalone server
  if (err && (err.code === 20 || err.code === 263) && /replica set|transaction/i.test(err.message)) {
    return new TransactionUnsupportedError();
  }
  return err;
}

/** For route handlers: { status, body } ready for Response.json(). */
function toHttpError(err) {
  const e = mapError(err);
  if (e && Number.isInteger(e.status)) {
    return { status: e.status, body: { error: e.name, message: e.message, ...(e.details ? { details: e.details } : {}) } };
  }
  return { status: 500, body: { error: 'InternalError', message: 'Unexpected database error' } };
}

/** Run fn, mapping any error it throws. */
async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    throw mapError(err);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Accept an ObjectId or its 24-character hex string (as sent by the browser). */
function toObjectId(id, name = 'id') {
  if (id && typeof id === 'object' && (id._bsontype === 'ObjectId' || id._bsontype === 'ObjectID')) return id;
  if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) throw new ValidationError(`${name} must be a 24-character hex id`);
  const { ObjectId } = requireDriver();
  return new ObjectId(id);
}

const toInt = (v, name) => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${name} must be a positive integer`);
  return n;
};

async function checkCase(options, caseId) {
  if (options.caseExists && !(await options.caseExists(caseId))) {
    throw new NotFoundError(`Emergency case ${caseId} does not exist`);
  }
}

async function runFind(db, query, limit = MAX_RESULTS) {
  return db.collection(query.collection)
    .find(query.filter, { projection: query.projection })
    .sort(query.sort)
    .limit(limit)
    .toArray();
}

const runAggregate = (db, query) => db.collection(query.collection).aggregate(query.pipeline).toArray();

async function runUpdate(db, query, notFoundMessage, session) {
  const res = await db.collection(query.collection).updateOne(query.filter, query.update, { session });
  if (res.matchedCount === 0) throw new NotFoundError(notFoundMessage);
  return { matched: res.matchedCount, modified: res.modifiedCount };
}

async function runDelete(db, query, notFoundMessage) {
  const coll = db.collection(query.collection);
  const res = query.many ? await coll.deleteMany(query.filter) : await coll.deleteOne(query.filter);
  if (!query.many && res.deletedCount === 0) throw new NotFoundError(notFoundMessage);
  return { deleted: res.deletedCount };
}

async function runInsert(db, query, session) {
  const res = await db.collection(query.collection).insertOne(query.document, { session });
  return { insertedId: res.insertedId, document: { _id: res.insertedId, ...query.document } };
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

const listCaseObservations = (db, user, { caseId }) => guard(async () => {
  assertCan(user, 'observations:read');
  return runFind(db, q.observationsForCase(toInt(caseId, 'caseId')));
});

const listRedFlags = (db, user, { from, to } = {}) => guard(async () => {
  assertCan(user, 'observations:read');
  return runFind(db, q.redFlagObservations({ from: from && new Date(from), to: to && new Date(to) }));
});

const listOpenIncidents = (db, user) => guard(async () => {
  assertCan(user, 'incidents:read');
  return runFind(db, q.openIncidents());
});

const listCaseIncidents = (db, user, { caseId }) => guard(async () => {
  assertCan(user, 'incidents:read');
  return runFind(db, q.incidentsForCase(toInt(caseId, 'caseId')));
});

const searchNotes = (db, user, { text, caseId }) => guard(async () => {
  assertCan(user, 'notes:read');
  return runFind(db, q.searchNotes(text, { caseId: caseId ? toInt(caseId, 'caseId') : undefined }), 50);
});

const listDraftNotes = (db, user) => guard(async () => {
  assertCan(user, 'notes:read');
  return runFind(db, q.draftNotesQueue());
});

const listCaseNotes = (db, user, { caseId }) => guard(async () => {
  assertCan(user, 'notes:read');
  return runFind(db, q.notesForCase(toInt(caseId, 'caseId')));
});

const news2Board = (db, user, { caseId, from, to } = {}) => guard(async () => {
  assertCan(user, 'reports:clinical');
  return runAggregate(db, q.news2Board({
    caseId: caseId ? toInt(caseId, 'caseId') : undefined,
    from: from && new Date(from),
    to: to && new Date(to),
  }));
});

const vitalsSummary = (db, user, { caseId } = {}) => guard(async () => {
  assertCan(user, 'reports:clinical');
  return runAggregate(db, q.vitalsSummary({ caseId: caseId ? toInt(caseId, 'caseId') : undefined }));
});

const caseTimeline = (db, user, { caseId }) => guard(async () => {
  assertCan(user, 'reports:clinical');
  return runAggregate(db, q.caseTimeline(toInt(caseId, 'caseId')));
});

const responseTimes = (db, user, { targetMinutes, from, to } = {}) => guard(async () => {
  assertCan(user, 'reports:operational');
  const [result] = await runAggregate(db, q.responseTimes({
    targetMinutes: targetMinutes ? toInt(targetMinutes, 'targetMinutes') : undefined,
    from: from && new Date(from),
    to: to && new Date(to),
  }));
  return result;
});

const incidentTrends = (db, user, { from, to } = {}) => guard(async () => {
  assertCan(user, 'reports:operational');
  const [result] = await runAggregate(db, q.incidentTrends({ from: from && new Date(from), to: to && new Date(to) }));
  return result;
});

const incidentHotspots = (db, user, { maxKm } = {}) => guard(async () => {
  assertCan(user, 'reports:operational');
  const [result] = await runAggregate(db, q.incidentHotspots({ maxKm: maxKm ? Number(maxKm) : undefined }));
  return result;
});

// ---------------------------------------------------------------------------
// observations: create / delete
// ---------------------------------------------------------------------------

const recordObservation = (db, user, input, options = {}) => guard(async () => {
  assertCan(user, 'observations:create');
  const caseId = toInt(input.caseId, 'caseId');
  await checkCase(options, caseId);
  const query = q.newObservation({ ...input, caseId, recordedBy: actorRef(user), now: options.now ?? new Date() });
  return runInsert(db, query);
});

const deleteObservation = (db, user, { caseId, observedAt, source }) => guard(async () => {
  assertCan(user, 'observations:delete');
  const query = q.deleteObservation({ caseId: toInt(caseId, 'caseId'), observedAt, source, recordedBy: actorRef(user) });
  return runDelete(db, query, 'No observation with that case, time and source recorded by you');
});

// ---------------------------------------------------------------------------
// incident reports
// ---------------------------------------------------------------------------

/**
 * Next incident number for a year, e.g. INC-2026-0009.
 * A counter document per year is incremented atomically ($inc), so two
 * people filing at the same moment always get different numbers. The
 * counter is first raised to the highest number already in use ($max), so
 * it also works on a database that was seeded without counters.
 */
async function nextIncidentNo(db, year) {
  const prefix = `INC-${year}-`;
  const counters = db.collection('counters');
  const last = await db.collection('incident_reports')
    .find({ incident_no: { $regex: `^${prefix}` } }, { projection: { _id: 0, incident_no: 1 } })
    .sort({ incident_no: -1 })
    .limit(1)
    .toArray();
  const highest = last.length ? Number(last[0].incident_no.slice(prefix.length)) : 0;
  const _id = `incident_no:${year}`;
  try {
    await counters.updateOne({ _id }, { $max: { seq: highest } }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err; // two first-ever upserts raced; the other one created it
    await counters.updateOne({ _id }, { $max: { seq: highest } });
  }
  const res = await counters.findOneAndUpdate({ _id }, { $inc: { seq: 1 } }, { returnDocument: 'after' });
  const doc = res && 'value' in res && 'ok' in res ? res.value : res; // driver 5 vs 6 result shape
  if (doc.seq > 9999) throw new ConflictError(`Incident numbers for ${year} are exhausted`);
  return `${prefix}${String(doc.seq).padStart(4, '0')}`;
}

const reportIncident = (db, user, input, options = {}) => guard(async () => {
  assertCan(user, 'incidents:create');
  const now = options.now ?? new Date();
  const caseIds = Array.isArray(input.caseIds) ? input.caseIds.map((c) => toInt(c, 'caseIds[]')) : input.caseIds;
  if (Array.isArray(caseIds)) for (const c of caseIds) await checkCase(options, c);
  const reportedAt = input.reportedAt ? new Date(input.reportedAt) : now;
  // validate the input before using up an incident number
  q.newIncident({ ...input, caseIds, incidentNo: 'INC-0000-0000', reportedAt, reportedBy: actorRef(user), now });
  const incidentNo = await nextIncidentNo(db, reportedAt.getUTCFullYear());
  const query = q.newIncident({ ...input, caseIds, incidentNo, reportedAt, reportedBy: actorRef(user), now });
  return runInsert(db, query);
});

const startIncidentReview = (db, user, { incidentNo, note }, options = {}) => guard(async () => {
  assertCan(user, 'incidents:review');
  return runUpdate(db, q.startIncidentReview({ incidentNo, note, now: options.now ?? new Date() }), `No open incident ${incidentNo}`);
});

const closeIncident = (db, user, { incidentNo, actions = [] }, options = {}) => guard(async () => {
  assertCan(user, 'incidents:close');
  const query = q.closeIncident({ incidentNo, reviewedBy: actorRef(user), actions, now: options.now ?? new Date() });
  return runUpdate(db, query, `No incident ${incidentNo} that is still open`);
});

/**
 * TRANSACTION: close an incident AND write the signed review note for the
 * patient's case, as one unit. Either both are saved or neither is: if the
 * note fails validation, the incident stays open.
 * Needs a replica set (MongoDB only supports multi-document transactions there).
 */
const closeIncidentWithNote = (db, user, { incidentNo, actions = [], caseId, title, body }, options = {}) => guard(async () => {
  assertCan(user, 'incidents:close');
  assertCan(user, 'notes:create');
  assertCan(user, 'notes:sign');
  const now = options.now ?? new Date();
  const id = toInt(caseId, 'caseId');
  const close = q.closeIncident({ incidentNo, reviewedBy: actorRef(user), actions, now });
  const note = q.newNote({
    caseId: id, noteType: 'progress', author: actorRef(user), title, body,
    links: { incident_no: incidentNo }, tags: ['incident-review'], now,
  });
  note.document.status = 'signed';
  note.document.signed_at = now;

  const session = db.client.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      // the incident must involve this case; checked inside the transaction
      close.filter.case_ids = id;
      const closed = await runUpdate(db, close, `No open incident ${incidentNo} for case ${id}`, session);
      const inserted = await runInsert(db, note, session);
      result = { incident: closed, note: inserted };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally {
    await session.endSession();
  }
});

const purgeClosedIncidents = (db, user, { closedBefore }, options = {}) => guard(async () => {
  assertCan(user, 'incidents:purge');
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(closedBefore);
  const latestAllowed = new Date((options.now ?? new Date()).getTime() - retentionDays * 86400000);
  if (!(cutoff <= latestAllowed)) {
    throw new ValidationError(`Closed incidents must be kept for ${retentionDays} days; closedBefore must be on or before ${latestAllowed.toISOString()}`);
  }
  return runDelete(db, q.purgeClosedIncidents({ closedBefore: cutoff }));
});

// ---------------------------------------------------------------------------
// clinical notes
// ---------------------------------------------------------------------------

const writeNote = (db, user, input, options = {}) => guard(async () => {
  assertCan(user, 'notes:create');
  const caseId = toInt(input.caseId, 'caseId');
  await checkCase(options, caseId);
  return runInsert(db, q.newNote({ ...input, caseId, author: actorRef(user), now: options.now ?? new Date() }));
});

const editDraftNote = (db, user, { noteId, title, body, tags, sections }, options = {}) => guard(async () => {
  assertCan(user, 'notes:edit');
  const query = q.editDraftNote({
    noteId: toObjectId(noteId, 'noteId'), author: actorRef(user), title, body, tags, sections, now: options.now ?? new Date(),
  });
  return runUpdate(db, query, 'No draft note with that id written by you');
});

/** Sign your own draft. */
const signNote = (db, user, { noteId }, options = {}) => guard(async () => {
  assertCan(user, 'notes:sign');
  const query = q.signNote({ noteId: toObjectId(noteId, 'noteId'), now: options.now ?? new Date() });
  query.filter.author = actorRef(user);
  return runUpdate(db, query, 'No draft note with that id written by you');
});

const amendNote = (db, user, { noteId, newBody, reason }, options = {}) => guard(async () => {
  assertCan(user, 'notes:amend');
  if (typeof newBody !== 'string' || newBody.trim() === '') throw new ValidationError('newBody is required');
  const query = q.amendNote({
    noteId: toObjectId(noteId, 'noteId'), newBody, reason, amendedBy: actorRef(user), now: options.now ?? new Date(),
  });
  return runUpdate(db, query, 'No signed note with that id');
});

const deleteDraftNote = (db, user, { noteId }) => guard(async () => {
  assertCan(user, 'notes:delete');
  return runDelete(db, q.deleteDraftNote({ noteId: toObjectId(noteId, 'noteId'), author: actorRef(user) }),
    'No draft note with that id written by you (signed notes cannot be deleted)');
});

module.exports = {
  // errors
  ValidationError, NotFoundError, ConflictError, TransactionUnsupportedError, AccessDeniedError,
  mapError, toHttpError, toObjectId,
  // reads
  listCaseObservations, listRedFlags, listOpenIncidents, listCaseIncidents,
  searchNotes, listDraftNotes, listCaseNotes,
  news2Board, vitalsSummary, caseTimeline, responseTimes, incidentTrends, incidentHotspots,
  // writes
  recordObservation, deleteObservation,
  nextIncidentNo, reportIncident, startIncidentReview, closeIncident, closeIncidentWithNote, purgeClosedIncidents,
  writeNote, editDraftNote, signNote, amendNote, deleteDraftNote,
  MAX_RESULTS, DEFAULT_RETENTION_DAYS,
};
