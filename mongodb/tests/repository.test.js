'use strict';

/**
 * lib/repository.js (the layer the Next.js API calls), run against the
 * in-memory fake database from tests/helpers/fake-db.js. Checks role
 * enforcement, author taken from the session, error mapping (400/403/404/
 * 409/501) and the incident-number counter. Real-server behaviour of the
 * same functions is covered in queries.integration.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repo = require('../lib/repository');
const { FakeDb } = require('./helpers/fake-db');
const { loadJsonDocuments } = require('../lib/load-json');

const DATA = path.join(__dirname, '..', 'data');
const ist = (s) => new Date(`${s}+05:30`);
const NOW = ist('2026-10-24T16:00:00');
const opts = { now: NOW };

const doctor2 = { role: 'doctor', doctor_id: 2 };
const doctor4 = { role: 'doctor', doctor_id: 4 };
const nurse6 = { role: 'nurse', staff_id: 6 };
const admin = { role: 'admin', staff_id: 1 };

function freshDb() {
  const db = new FakeDb();
  for (const name of ['incident_reports', 'observation_logs', 'clinical_notes']) {
    db.load(name, loadJsonDocuments(path.join(DATA, `${name}.json`)));
  }
  return db;
}

const rejectsWith = (promise, status, re) => assert.rejects(promise, (e) => {
  assert.equal(e.status, status, `${e.name}: ${e.message}`);
  if (re) assert.match(e.message, re);
  return true;
});

const obsInput = {
  caseId: 5, observedAt: ist('2026-10-24T15:00:00'), source: 'ward',
  vitals: { heart_rate: 92, resp_rate: 18, spo2: 97, on_supplemental_o2: false, consciousness: 'A' },
};

test('recordObservation: author comes from the session, not the request', async () => {
  const db = freshDb();
  const res = await repo.recordObservation(db, nurse6, { ...obsInput, recordedBy: { doctor_id: 1 } }, opts);
  assert.deepEqual(res.document.recorded_by, { staff_id: 6 });
  assert.equal(await db.collection('observation_logs').countDocuments({ case_id: 5 }), 5);
});

test('recordObservation: duplicate -> 409, bad vitals -> 400 with details, admin -> 403', async () => {
  const db = freshDb();
  await repo.recordObservation(db, nurse6, obsInput, opts);
  await rejectsWith(repo.recordObservation(db, nurse6, obsInput, opts), 409, /case_id, observed_at, source/);
  await assert.rejects(
    repo.recordObservation(db, nurse6, { ...obsInput, observedAt: ist('2026-10-24T15:05:00'), vitals: { spo2: 120 } }, opts),
    (e) => e.status === 400 && Array.isArray(e.details) && e.details.some((d) => d.includes('spo2')),
  );
  await rejectsWith(repo.recordObservation(db, admin, obsInput, opts), 403);
  await rejectsWith(repo.recordObservation(db, nurse6, { ...obsInput, observedAt: ist('2026-10-25T00:00:00') }, opts), 400, /future/);
});

test('writes check the case exists in MySQL when the API passes caseExists', async () => {
  const db = freshDb();
  const caseExists = async (id) => id <= 10;
  await rejectsWith(repo.recordObservation(db, nurse6, { ...obsInput, caseId: 99 }, { ...opts, caseExists }), 404, /case 99/);
  await rejectsWith(repo.writeNote(db, doctor4, { caseId: 42, noteType: 'progress', title: 'Note', body: 'x' }, { ...opts, caseExists }), 404);
  const ok = await repo.recordObservation(db, nurse6, obsInput, { ...opts, caseExists });
  assert.ok(ok.insertedId);
});

test('deleteObservation: only the person who recorded it', async () => {
  const db = freshDb();
  await repo.recordObservation(db, nurse6, obsInput, opts);
  const key = { caseId: 5, observedAt: obsInput.observedAt, source: 'ward' };
  await rejectsWith(repo.deleteObservation(db, { role: 'nurse', staff_id: 2 }, key), 404);
  assert.deepEqual(await repo.deleteObservation(db, nurse6, key), { deleted: 1 });
  await rejectsWith(repo.deleteObservation(db, admin, key), 403);
});

test('reportIncident numbers incidents from an atomic counter', async () => {
  const db = freshDb();
  const input = {
    category: 'in_hospital', incidentType: 'patient_fall', caseIds: ['9'],
    occurredAt: '2026-10-24T15:10:00+05:30', reportedAt: '2026-10-24T15:20:00+05:30',
    location: { description: 'Ward bay 2' }, severity: 'low', harmLevel: 'none',
    summary: 'Patient slipped while walking, no injury found.',
  };
  const a = await repo.reportIncident(db, nurse6, input, opts);
  const b = await repo.reportIncident(db, doctor4, input, opts);
  assert.equal(a.document.incident_no, 'INC-2026-0009'); // continues after the seeded 0008
  assert.equal(b.document.incident_no, 'INC-2026-0010');
  assert.deepEqual(a.document.case_ids, [9]);
  assert.deepEqual(a.document.reported_by, { staff_id: 6 });
  assert.equal(a.document.status, 'open');
  await rejectsWith(repo.reportIncident(db, admin, input, opts), 403);
});

test('incident review and closing: role checks and forward-only status', async () => {
  const db = freshDb();
  await rejectsWith(repo.startIncidentReview(db, nurse6, { incidentNo: 'INC-2026-0007' }, opts), 403);
  assert.equal((await repo.startIncidentReview(db, admin, { incidentNo: 'INC-2026-0007' }, opts)).modified, 1);
  await rejectsWith(repo.startIncidentReview(db, admin, { incidentNo: 'INC-2026-0007' }, opts), 404);
  await rejectsWith(repo.closeIncident(db, nurse6, { incidentNo: 'INC-2026-0007' }, opts), 403);
  await repo.closeIncident(db, doctor2, { incidentNo: 'INC-2026-0007', actions: ['Priority CT slot'] }, opts);
  const doc = await db.collection('incident_reports').findOne({ incident_no: 'INC-2026-0007' });
  assert.equal(doc.status, 'closed');
  assert.deepEqual(doc.follow_up.reviewed_by, { doctor_id: 2 });
  assert.deepEqual(doc.timeline.map((e) => e.event).slice(-2), ['reviewed', 'closed']);
  await rejectsWith(repo.closeIncident(db, doctor2, { incidentNo: 'INC-2026-0007' }, opts), 404);
});

test('closeIncidentWithNote reports 501 on a server without transactions', async () => {
  const db = freshDb();
  await rejectsWith(repo.closeIncidentWithNote(db, doctor2, {
    incidentNo: 'INC-2026-0007', caseId: 3, title: 'Incident review', body: 'Reviewed with radiology.',
  }, opts), 501, /replica set/);
  // nothing was changed
  assert.equal((await db.collection('incident_reports').findOne({ incident_no: 'INC-2026-0007' })).status, 'open');
  await rejectsWith(repo.closeIncidentWithNote(db, admin, { incidentNo: 'INC-2026-0007', caseId: 3, title: 'x', body: 'y' }, opts), 403);
});

test('purgeClosedIncidents: admin only, and closed incidents are kept for the retention period', async () => {
  const db = freshDb();
  const cutoff = { closedBefore: ist('2026-10-24T09:15:00') };
  await rejectsWith(repo.purgeClosedIncidents(db, doctor2, cutoff, opts), 403);
  await rejectsWith(repo.purgeClosedIncidents(db, admin, cutoff, opts), 400, /365 days/);
  assert.deepEqual(await repo.purgeClosedIncidents(db, admin, cutoff, { ...opts, retentionDays: 0 }), { deleted: 2 });
  assert.equal(await db.collection('incident_reports').countDocuments({}), 6);
});

test('notes: write, edit and delete your own drafts; signed notes are protected', async () => {
  const db = freshDb();
  const { insertedId } = await repo.writeNote(db, doctor4, {
    caseId: 9, noteType: 'progress', title: 'Progress: fall review', body: 'No injury.', author: { doctor_id: 1 },
  }, opts);
  const note = await db.collection('clinical_notes').findOne({ _id: insertedId });
  assert.deepEqual(note.author, { doctor_id: 4 });
  assert.equal(note.status, 'draft');

  await rejectsWith(repo.editDraftNote(db, doctor2, { noteId: insertedId, body: 'hijack' }, opts), 404);
  await repo.editDraftNote(db, doctor4, { noteId: insertedId, body: 'No injury. Falls plan updated.' }, opts);
  await rejectsWith(repo.signNote(db, doctor2, { noteId: insertedId }, opts), 404, /written by you/);
  await repo.signNote(db, doctor4, { noteId: insertedId }, opts);
  await rejectsWith(repo.deleteDraftNote(db, doctor4, { noteId: insertedId }), 404, /signed notes cannot be deleted/);
  await rejectsWith(repo.amendNote(db, nurse6, { noteId: insertedId, newBody: 'x', reason: 'typo fix' }, opts), 403);

  const draft = await db.collection('clinical_notes').findOne({ case_id: 1, status: 'draft' });
  assert.deepEqual(await repo.deleteDraftNote(db, doctor2, { noteId: draft._id }), { deleted: 1 });
});

test('reads are role-checked and capped', async () => {
  const db = freshDb();
  assert.equal((await repo.listCaseObservations(db, nurse6, { caseId: '8' })).length, 6);
  assert.equal((await repo.listOpenIncidents(db, admin)).length, 2);
  assert.equal((await repo.listCaseNotes(db, doctor2, { caseId: 1 })).length, 3);
  await rejectsWith(repo.listCaseNotes(db, admin, { caseId: 1 }), 403);
  await rejectsWith(repo.listCaseObservations(db, admin, { caseId: 8 }), 403);
  await rejectsWith(repo.listCaseObservations(db, nurse6, { caseId: 'abc' }), 400);
});

test('toHttpError gives a safe JSON body and never leaks unknown errors', () => {
  assert.deepEqual(repo.toHttpError(Object.assign(new Error('E11000'), { code: 11000, keyValue: { incident_no: 'x' } })), {
    status: 409, body: { error: 'ConflictError', message: 'A record with the same key already exists (incident_no)' },
  });
  assert.equal(repo.toHttpError(Object.assign(new Error('x'), { code: 121, errInfo: { details: ['d'] } })).body.details[0], 'd');
  assert.deepEqual(repo.toHttpError(new Error('connection string with password')), {
    status: 500, body: { error: 'InternalError', message: 'Unexpected database error' },
  });
  assert.throws(() => repo.toObjectId('not-an-id'), (e) => e.status === 400);
});
