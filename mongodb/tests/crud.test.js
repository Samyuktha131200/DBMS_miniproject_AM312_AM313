'use strict';

/**
 * Insert / update / delete builders (C1-C3, U4-U5, D1-D3): the documents
 * they build pass the validators, and their filters only match what they
 * should. No server needed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const q = require('../lib/queries');
const { demos, WRITE_TYPES } = require('../lib/demos');
const { validators } = require('../schema');
const { validate } = require('./helpers/json-schema');
const { matches } = require('./helpers/fake-db');
const { loadJsonDocuments } = require('../lib/load-json');

const ist = (s) => new Date(`${s}+05:30`);
const DATA = path.join(__dirname, '..', 'data');
const incidents = loadJsonDocuments(path.join(DATA, 'incident_reports.json'));
const notes = loadJsonDocuments(path.join(DATA, 'clinical_notes.json'));
const NOW = ist('2026-10-24T16:00:00');

test('every insert demo builds a document the validator accepts', () => {
  const inserts = demos.filter((d) => d.type === 'insert');
  assert.equal(inserts.length, 3);
  for (const d of inserts) {
    const { collection, document } = d.build();
    assert.deepEqual(validate(validators[collection], document), [], d.id);
    assert.equal(document.schema_version, 1);
  }
});

test('write demos are all gated, each has something to show, ids are unique', () => {
  const writes = demos.filter((d) => WRITE_TYPES.includes(d.type));
  assert.deepEqual(writes.map((d) => d.type.slice(0, 1)), ['i', 'i', 'i', 'u', 'u', 'u', 'u', 'u', 'd', 'd', 'd']);
  for (const d of writes) assert.ok(d.show && d.show.collection, d.id);
  assert.equal(new Set(demos.map((d) => d.id)).size, demos.length);
});

test('C1 newObservation: rejects future times, empty vitals and bad people', () => {
  const base = { caseId: 5, observedAt: ist('2026-10-24T15:00:00'), source: 'ward', recordedBy: { staff_id: 6 }, vitals: { spo2: 97 }, now: NOW };
  assert.equal(q.newObservation(base).document.case_id, 5);
  assert.throws(() => q.newObservation({ ...base, observedAt: ist('2026-10-24T17:00:00') }), /future/);
  assert.throws(() => q.newObservation({ ...base, vitals: {} }), /at least one/);
  assert.throws(() => q.newObservation({ ...base, recordedBy: { staff_id: 6, doctor_id: 1 } }), /doctor_id\} or \{staff_id/);
  assert.throws(() => q.newObservation({ ...base, observedAt: 'yesterday' }), /valid date/);
  assert.throws(() => q.newObservation({ ...base, caseId: '5' }), /positive integer/);
  // optional fields are left out, not stored as undefined/null
  assert.ok(!('additional' in q.newObservation(base).document));
});

test('C1 out-of-range vitals are caught by the validator, not silently stored', () => {
  const { document } = q.newObservation({
    caseId: 5, observedAt: ist('2026-10-24T15:00:00'), source: 'ward', recordedBy: { staff_id: 6 },
    vitals: { spo2: 120, heart_rate: 92.5 }, now: NOW,
  });
  const errors = validate(validators.observation_logs, document);
  assert.ok(errors.some((e) => e.includes('spo2')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('heart_rate')), errors.join('\n'));
});

test('C2 newIncident: always opens, checks report time, needs a case', () => {
  const base = {
    incidentNo: 'INC-2026-0009', category: 'in_hospital', incidentType: 'patient_fall', caseIds: [9],
    occurredAt: ist('2026-10-24T15:10:00'), reportedAt: ist('2026-10-24T15:20:00'), reportedBy: { staff_id: 5 },
    location: { description: 'Ward bay 2' }, severity: 'low', harmLevel: 'none',
    summary: 'Patient slipped, no injury found.', now: NOW,
  };
  const { document } = q.newIncident(base);
  assert.equal(document.status, 'open');
  assert.deepEqual(validate(validators.incident_reports, document), []);
  assert.throws(() => q.newIncident({ ...base, reportedAt: ist('2026-10-24T15:00:00') }), /before occurredAt/);
  assert.throws(() => q.newIncident({ ...base, caseIds: [] }), /at least one case/);
  // an in-hospital incident without harm_level fails the category rule (oneOf)
  const noHarm = q.newIncident({ ...base, harmLevel: undefined }).document;
  assert.ok(validate(validators.incident_reports, noHarm).some((e) => /oneOf/.test(e)));
});

test('C3 newNote: always a draft, author required', () => {
  const { document } = q.newNote({ caseId: 9, noteType: 'progress', author: { doctor_id: 4 }, title: 'Progress', body: 'Fine.', now: NOW });
  assert.equal(document.status, 'draft');
  assert.ok(!('signed_at' in document));
  assert.deepEqual(validate(validators.clinical_notes, document), []);
  assert.throws(() => q.newNote({ caseId: 9, noteType: 'progress', title: 'x', body: 'y' }), /author/);
});

test('U4 startIncidentReview only matches open incidents', () => {
  const u = q.startIncidentReview({ incidentNo: 'INC-2026-0007', now: NOW });
  assert.deepEqual(u.filter, { incident_no: 'INC-2026-0007', status: 'open' });
  const matched = incidents.filter((d) => matches(u.filter, d)).map((d) => d.incident_no);
  assert.deepEqual(matched, ['INC-2026-0007']);
  assert.equal(incidents.filter((d) => matches({ ...u.filter, incident_no: 'INC-2026-0005' }, d)).length, 0, 'under_review must not match');
  assert.deepEqual(u.update.$push.timeline, { event: 'reviewed', at: NOW });
});

test('U5 editDraftNote only matches the author\'s own drafts', () => {
  const draft = notes.find((n) => n.case_id === 1 && n.status === 'draft');
  const signed = notes.find((n) => n.case_id === 1 && n.status === 'signed');
  const f = (noteId, author) => q.editDraftNote({ noteId, author, body: 'new', now: NOW }).filter;
  // compare by note identity: use the title as the stand-in for _id in plain JSON
  const hit = (filter, n) => matches({ ...filter, _id: undefined }, { ...n, _id: undefined });
  assert.ok(hit(f(draft._id, { doctor_id: 2 }), draft));
  assert.ok(!hit(f(draft._id, { doctor_id: 1 }), draft), 'other doctor');
  assert.ok(!hit(f(signed._id, signed.author), signed), 'signed note');
  assert.throws(() => q.editDraftNote({ noteId: 'x', author: { doctor_id: 2 }, now: NOW }), /nothing to change/);
});

test('D1 deleteDraftNote never matches a signed or amended note', () => {
  for (const n of notes) {
    const { filter } = q.deleteDraftNote({ noteId: n._id, author: n.author });
    assert.equal(matches({ ...filter, _id: undefined }, { ...n, _id: undefined }), n.status === 'draft', n.title);
  }
});

test('D2 deleteObservation is keyed by case, time, source and recorder', () => {
  const { filter } = q.deleteObservation({ caseId: 5, observedAt: '2026-10-24T15:00:00+05:30', source: 'ward', recordedBy: { staff_id: 6 } });
  assert.deepEqual(Object.keys(filter).sort(), ['case_id', 'observed_at', 'recorded_by', 'source']);
  assert.ok(filter.observed_at instanceof Date);
});

test('D3 purge removes only closed incidents older than the cutoff', () => {
  const { filter, many } = q.purgeClosedIncidents({ closedBefore: ist('2026-10-24T09:15:00') });
  assert.equal(many, true);
  assert.deepEqual(incidents.filter((d) => matches(filter, d)).map((d) => d.incident_no), ['INC-2026-0001', 'INC-2026-0002']);
  // even with a cutoff far in the future, open / under-review incidents survive
  const all = q.purgeClosedIncidents({ closedBefore: ist('2030-01-01T00:00:00') }).filter;
  assert.ok(incidents.filter((d) => matches(all, d)).every((d) => d.status === 'closed'));
  assert.throws(() => q.purgeClosedIncidents({}), /valid date/);
});
