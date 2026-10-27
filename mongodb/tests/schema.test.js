'use strict';

/**
 * Unit tests that need NO MongoDB server:
 *  - every sample document passes its collection's validator
 *  - invalid documents are rejected for the right reason
 *  - index definitions are well-formed
 * Run: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { validators, indexes, COLLECTIONS } = require('../schema');
const { loadJsonDocuments } = require('../lib/load-json');
const { validate } = require('./helpers/json-schema');

const DATA = path.join(__dirname, '..', 'data');
const load = (name) => loadJsonDocuments(path.join(DATA, `${name}.json`));
const clone = (doc) => structuredClone(doc);

for (const { name } of COLLECTIONS) {
  test(`all sample documents in ${name} pass the validator`, () => {
    const docs = load(name);
    assert.ok(docs.length > 0, 'sample file is empty');
    docs.forEach((doc, i) => {
      assert.deepEqual(validate(validators[name], doc), [], `document #${i} is invalid`);
    });
  });
}

/** Each case: [description, mutate(doc), expected error fragment]. */
function rejects(collection, baseIndex, cases) {
  const base = load(collection)[baseIndex];
  for (const [description, mutate, fragment] of cases) {
    test(`${collection} rejects: ${description}`, () => {
      const doc = clone(base);
      mutate(doc);
      const errors = validate(validators[collection], doc);
      assert.ok(errors.length > 0, 'document was accepted but should be rejected');
      if (fragment) {
        assert.ok(
          errors.some((e) => e.includes(fragment)),
          `expected an error containing "${fragment}", got:\n${errors.join('\n')}`,
        );
      }
    });
  }
}

// base: INC-2026-0001 (prehospital)
rejects('incident_reports', 0, [
  ['prehospital incident without map coordinates', (d) => delete d.location.geo, 'oneOf'],
  ['prehospital incident without a timeline', (d) => delete d.timeline, 'oneOf'],
  ['in-hospital incident without harm_level', (d) => { d.category = 'in_hospital'; }, 'oneOf'],
  ['copied patient data (patient_name)', (d) => { d.patient_name = 'Arjun Rao'; }, 'unexpected field "patient_name"'],
  ['empty case_ids', (d) => { d.case_ids = []; }, 'fewer than 1 items'],
  ['duplicate case_ids', (d) => { d.case_ids = [1, 1]; }, 'items not unique'],
  ['malformed incident_no', (d) => { d.incident_no = 'INC-1'; }, 'does not match'],
  ['reporter with both staff_id and doctor_id', (d) => { d.reported_by = { staff_id: 7, doctor_id: 1 }; }, 'more than 1 fields'],
  ['reporter with no ID', (d) => { d.reported_by = {}; }, 'fewer than 1 fields'],
  ['longitude out of range', (d) => { d.location.geo.coordinates = [200, 12.97]; }, 'maximum 180'],
  ['occurred_at stored as text', (d) => { d.occurred_at = '2026-10-24 07:45'; }, 'expected bsonType date'],
  ['unknown timeline event', (d) => { d.timeline[0].event = 'coffee_break'; }, 'not in enum'],
  ['unknown severity', (d) => { d.severity = 'extreme'; }, 'not in enum'],
  ['missing summary', (d) => delete d.summary, 'missing required field "summary"'],
]);

// base: first observation for case 1
rejects('observation_logs', 0, [
  ['SpO2 above 100', (d) => { d.vitals.spo2 = 101; }, 'maximum 100'],
  ['heart rate with decimals', (d) => { d.vitals.heart_rate = 72.5; }, 'expected bsonType int'],
  ['unknown consciousness level', (d) => { d.vitals.consciousness = 'X'; }, 'not in enum'],
  ['empty vitals', (d) => { d.vitals = {}; }, 'fewer than 1 fields'],
  ['blood pressure without diastolic', (d) => { delete d.vitals.bp.diastolic; }, 'missing required field "diastolic"'],
  ['unknown vital sign field', (d) => { d.vitals.mood = 'ok'; }, 'unexpected field "mood"'],
  ['case_id of 0', (d) => { d.case_id = 0; }, 'minimum 1'],
  ['unknown source', (d) => { d.source = 'home'; }, 'not in enum'],
]);

// base: case 1 triage note (signed)
rejects('clinical_notes', 0, [
  ['signed note without signed_at', (d) => delete d.signed_at, 'anyOf'],
  ['amended note without amendments', (d) => { d.status = 'amended'; }, 'anyOf'],
  ['tag with spaces / capitals', (d) => { d.tags = ['Chest Pain']; }, 'does not match'],
  ['empty body', (d) => { d.body = ''; }, 'shorter than 1'],
  ['copied doctor name', (d) => { d.doctor_name = 'Dr Amit Rao'; }, 'unexpected field "doctor_name"'],
  ['unknown link type', (d) => { d.links = { bill_id: 1 }; }, 'unexpected field "bill_id"'],
  ['unknown note type', (d) => { d.note_type = 'gossip'; }, 'not in enum'],
]);

test('a draft note does not need signed_at', () => {
  const draft = load('clinical_notes').find((n) => n.status === 'draft');
  assert.ok(draft, 'sample data should include a draft note');
  assert.ok(!('signed_at' in draft));
  assert.deepEqual(validate(validators.clinical_notes, draft), []);
});

test('an in-hospital incident without map coordinates is valid', () => {
  const doc = load('incident_reports').find((d) => d.category === 'in_hospital');
  assert.ok(!doc.location.geo);
  assert.deepEqual(validate(validators.incident_reports, doc), []);
});

test('index definitions are well-formed', () => {
  for (const { name, schema } of COLLECTIONS) {
    const names = indexes[name].map((ix) => ix.name);
    assert.equal(new Set(names).size, names.length, `duplicate index names in ${name}`);
    for (const ix of indexes[name]) {
      assert.ok(ix.name && ix.key && Object.keys(ix.key).length > 0, `bad index in ${name}`);
      // every indexed field must exist in the validator (catches typos)
      for (const field of Object.keys(ix.key)) {
        const top = field.split('.')[0];
        assert.ok(top in schema.properties, `${name}.${ix.name} indexes unknown field "${field}"`);
      }
    }
    const textIndexes = indexes[name].filter((ix) => Object.values(ix.key).includes('text'));
    assert.ok(textIndexes.length <= 1, `${name} has more than one text index`);
  }
});

test('every validator allows _id and is strict at the top level', () => {
  for (const { name, schema } of COLLECTIONS) {
    assert.equal(schema.additionalProperties, false, name);
    assert.deepEqual(schema.properties._id, { bsonType: 'objectId' }, name);
  }
});
