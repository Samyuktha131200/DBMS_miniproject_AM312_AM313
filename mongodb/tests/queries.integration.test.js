'use strict';

/**
 * INTEGRATION TESTS - need a running MongoDB (6.0+).
 *
 * Skipped unless MONGODB_TEST_URI is set. They create a throw-away database
 * (her_test_<random>), run setup + seed, then check against the real server:
 *  - validators reject bad documents (error 121) and unique indexes reject
 *    duplicates (error 11000)
 *  - every demo query returns exactly what the plain-JS reference computes
 *  - the expected index is used (explain)
 *  - the insert / update / delete demos behave as documented
 *  - lib/repository.js (the API layer): error mapping, incident counter,
 *    note lifecycle, the close-incident transaction (commit path needs a
 *    replica set), and creation of the database roles
 * The database is dropped at the end.
 *
 *   MONGODB_TEST_URI=mongodb://localhost:27017 npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { setupDatabase } = require('../scripts/setup');
const { seedDatabase } = require('../scripts/seed');
const { runDemo } = require('../scripts/run-queries');
const { demos, SAMPLE_DAY, AS_OF, BOARD_TIME } = require('../lib/demos');
const { validators } = require('../schema');
const { createReference } = require('./helpers/reference');
const { validate } = require('./helpers/json-schema');

const URI = process.env.MONGODB_TEST_URI;
let driver = null;
try { driver = require('mongodb'); } catch { /* reported via skip reason */ }
const skip = !URI
  ? 'set MONGODB_TEST_URI to run integration tests against a real MongoDB'
  : !driver ? 'run `npm install` first (mongodb driver missing)' : false;

/** Make results comparable: Dates -> ISO strings, drop _id, round floats. */
function normalize(v) {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    if (v._bsontype === 'ObjectId') return 'ObjectId';
    const out = {};
    for (const [k, x] of Object.entries(v)) if (k !== '_id') out[k] = normalize(x);
    return out;
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 1000) / 1000;
  return v;
}

const demo = (id) => demos.find((d) => d.id === id);

test('MongoDB integration', { skip, timeout: 120000 }, async (t) => {
  const client = new driver.MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const dbName = `her_test_${crypto.randomBytes(4).toString('hex')}`;
  const db = client.db(dbName);
  const ref = createReference();
  const quiet = { log: () => {} };

  try {
    await t.test('server version is 6.0 or newer', async () => {
      const { version } = await db.admin().serverInfo();
      assert.ok(Number(version.split('.')[0]) >= 6, `MongoDB ${version} is too old`);
    });

    await t.test('setup creates collections, validators and indexes', async () => {
      const summary = await setupDatabase(db, quiet);
      assert.equal(summary.length, 3);
      const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
      assert.deepEqual(names, ['clinical_notes', 'incident_reports', 'observation_logs']);
      const idx = (await db.collection('clinical_notes').indexes()).map((i) => i.name);
      for (const n of ['case_created', 'notes_text', 'draft_queue', 'author_doctor_created']) assert.ok(idx.includes(n), n);
      // running setup again must not fail
      const again = await setupDatabase(db, quiet);
      assert.ok(again.every((s) => s.action === 'updated'));
    });

    await t.test('seed inserts all sample documents through the validators', async () => {
      const s = await seedDatabase(db, quiet);
      assert.deepEqual(s.map((x) => x.inserted), [8, 32, 14]);
    });

    await t.test('server-side validator rejects bad documents (code 121)', async () => {
      const obs = db.collection('observation_logs');
      const base = await obs.findOne({ case_id: 1 }, { projection: { _id: 0 } });
      const bad = [
        { ...base, observed_at: new Date('2026-10-24T05:00:00Z'), vitals: { ...base.vitals, spo2: 120 } },
        { ...base, observed_at: new Date('2026-10-24T05:01:00Z'), patient_name: 'copied from MySQL' },
        { ...base, observed_at: new Date('2026-10-24T05:02:00Z'), recorded_by: { staff_id: 1, doctor_id: 1 } },
      ];
      for (const doc of bad) {
        await assert.rejects(obs.insertOne(doc), (err) => err.code === 121, JSON.stringify(doc).slice(0, 80));
      }
      const inc = await db.collection('incident_reports').findOne({ category: 'prehospital' }, { projection: { _id: 0 } });
      const noGeo = { ...inc, incident_no: 'INC-2026-9999', location: { description: 'Somewhere' } };
      await assert.rejects(db.collection('incident_reports').insertOne(noGeo), (err) => err.code === 121);
    });

    await t.test('unique indexes reject duplicates (code 11000)', async () => {
      const obs = await db.collection('observation_logs').findOne({}, { projection: { _id: 0 } });
      await assert.rejects(db.collection('observation_logs').insertOne(obs), (err) => err.code === 11000);
      const inc = await db.collection('incident_reports').findOne({}, { projection: { _id: 0 } });
      await assert.rejects(db.collection('incident_reports').insertOne(inc), (err) => err.code === 11000);
    });

    // ---- read demos vs reference ------------------------------------------
    const expected = {
      'case-observations': () => ref.observationsForCase(8),
      'red-flags': () => ref.redFlagObservations(SAMPLE_DAY),
      'open-incidents': () => ref.openIncidents(),
      'case-incidents': () => ref.incidentsForCase(3),
      'draft-queue': () => ref.draftNotesQueue(),
      'news2-board': () => ref.news2Board({ from: SAMPLE_DAY.from, to: BOARD_TIME }),
      'response-times': () => [ref.responseTimes({ targetMinutes: 15, ...SAMPLE_DAY })],
      'incident-trends': () => [ref.incidentTrends({ ...SAMPLE_DAY, asOf: AS_OF })],
      'vitals-summary': () => ref.vitalsSummary(),
      'case-timeline': () => ref.caseTimeline(8),
    };
    for (const [id, compute] of Object.entries(expected)) {
      await t.test(`${demo(id).title} matches the reference`, async () => {
        const { result } = await runDemo(db, demo(id));
        assert.deepEqual(normalize(result), normalize(compute()));
      });
    }

    await t.test('A4 hotspots match the reference within 0.1 km', async () => {
      const [{ nearest, by_distance_band }] = (await runDemo(db, demo('hotspots'))).result;
      const exp = ref.incidentHotspots({ maxKm: 30 });
      assert.deepEqual(nearest.map((n) => n.incident_no), exp.nearest.map((n) => n.incident_no));
      nearest.forEach((n, i) => assert.ok(Math.abs(n.distance_km - exp.nearest[i].distance_km) <= 0.1, n.incident_no));
      assert.deepEqual(by_distance_band, exp.by_distance_band);
    });

    await t.test('F5 text search finds the five notes about oxygen or breathlessness', async () => {
      const { result } = await runDemo(db, demo('search-notes'));
      assert.deepEqual(result.map((n) => n.title).sort(), [
        'Assessment: acute breathlessness',
        'Cardiology assessment',
        'Escalation: increased work of breathing',
        'Progress: pain settling',
        'Triage: central chest pain',
      ]);
      for (let i = 1; i < result.length; i += 1) assert.ok(result[i - 1].score >= result[i].score, 'not sorted by score');
    });

    await t.test('queries use the intended indexes', async () => {
      const expectIndex = {
        'case-observations': 'uniq_case_observed_source',
        'open-incidents': 'status_occurred',
        'case-incidents': 'case_ids',
        'search-notes': 'notes_text',
        'draft-queue': 'draft_queue',
        hotspots: 'location_geo_2dsphere',
      };
      for (const [id, index] of Object.entries(expectIndex)) {
        const { plan } = await runDemo(db, demo(id), { explain: true });
        assert.ok(plan.indexes.includes(index), `${id}: expected ${index}, plan used ${plan.indexes.join(', ') || 'no index'}`);
        assert.equal(plan.collectionScan, false, `${id}: unexpected COLLSCAN`);
      }
    });

    // ---- insert demos + U4 (run before U1, which closes INC-2026-0007) --------
    await t.test('C1-C3 inserts pass the server validator; C1 cannot be inserted twice', async () => {
      for (const id of ['record-observation', 'report-incident', 'write-note']) {
        const { result, after } = await runDemo(db, demo(id));
        assert.equal(result.acknowledged, true, id);
        assert.ok(after, `${id}: inserted document not found`);
      }
      await assert.rejects(runDemo(db, demo('record-observation')), (err) => err.code === 11000);
      const bad = demo('record-observation').build().document;
      bad.observed_at = new Date('2026-10-24T09:40:00Z');
      bad.vitals = { ...bad.vitals, spo2: 120 };
      await assert.rejects(db.collection('observation_logs').insertOne(bad), (err) => err.code === 121);
      const { result } = await runDemo(db, demo('search-notes'));
      assert.equal(result.length, 5, 'new note must not change the F5 demo result');
    });

    await t.test('U4 start review moves INC-2026-0007 to under_review exactly once', async () => {
      const first = await runDemo(db, demo('start-review'));
      assert.equal(first.result.modifiedCount, 1);
      assert.equal(first.after.status, 'under_review');
      assert.equal(first.after.timeline.at(-1).event, 'reviewed');
      assert.equal((await runDemo(db, demo('start-review'))).result.matchedCount, 0);
    });

    // ---- update demos -------------------------------------------------------
    for (const id of ['close-incident', 'sign-note', 'amend-note']) {
      await t.test(`${demo(id).title}: valid result, not applied twice`, async () => {
        const first = await runDemo(db, demo(id));
        assert.equal(first.result.modifiedCount, 1);
        const doc = await db.collection(demo(id).show.collection).findOne(demo(id).show.filter);
        assert.deepEqual(validate(validators[demo(id).show.collection], doc), []);
        if (id === 'close-incident') {
          assert.equal(doc.status, 'closed');
          assert.equal(doc.timeline.at(-1).event, 'closed');
          assert.deepEqual(doc.follow_up.reviewed_by, { doctor_id: 3 });
          const again = await runDemo(db, demo(id));
          assert.equal(again.result.matchedCount, 0);
        }
        if (id === 'sign-note') {
          assert.equal(doc.status, 'signed');
          const again = await runDemo(db, { ...demo(id), build: () => ({ ...demo(id).build(), filter: { _id: doc._id, status: 'draft' } }) });
          assert.equal(again.result.matchedCount, 0);
        }
        if (id === 'amend-note') {
          assert.equal(doc.status, 'amended');
          assert.equal(doc.amendments.length, 1);
          assert.match(doc.amendments[0].previous_body, /Fracture clinic follow-up arranged\.$/);
          assert.match(doc.body, /in 7 days\.$/);
          assert.equal(typeof doc.amendments[0].amended_by.doctor_id, 'number');
        }
      });
    }

    // ---- remaining write demos ------------------------------------------------
    await t.test('U5 edits the case 1 draft, then D1 deletes it (signed notes untouched)', async () => {
      const edit = await runDemo(db, demo('edit-draft'));
      assert.equal(edit.result.modifiedCount, 1);
      assert.match(edit.after.body, /Repeat troponin pending/);
      const del = await runDemo(db, demo('delete-draft'));
      assert.deepEqual([del.result.deletedCount, del.before, del.after], [1, 3, 2]);
      assert.equal(await db.collection('clinical_notes').countDocuments({ case_id: 1, status: 'signed' }), 2);
    });

    await t.test('D2 removes the C1 reading; D3 purges only old closed incidents', async () => {
      const d2 = await runDemo(db, demo('delete-observation'));
      assert.deepEqual([d2.result.deletedCount, d2.after], [1, 4]);
      const d3 = await runDemo(db, demo('purge-incidents'));
      assert.equal(d3.result.deletedCount, 2);
      const left = (await db.collection('incident_reports').find({}, { projection: { incident_no: 1 } }).toArray()).map((d) => d.incident_no);
      assert.ok(!left.includes('INC-2026-0001') && !left.includes('INC-2026-0002'));
      assert.ok(left.includes('INC-2026-0005'), 'under_review incident must survive');
    });

    // ---- repository (the API layer) on the real server ------------------------
    await seedDatabase(db, { reset: true, log: () => {} });
    const repo = require('../lib/repository');
    const nurse = { role: 'nurse', staff_id: 6 };
    const doctor = { role: 'doctor', doctor_id: 4 };
    const admin = { role: 'admin', staff_id: 1 };
    const now = { now: new Date('2026-10-24T10:30:00Z') };

    await t.test('repository: validation, duplicates and roles map to 400 / 409 / 403', async () => {
      const input = { caseId: 5, observedAt: '2026-10-24T15:00:00+05:30', source: 'ward', vitals: { spo2: 97, heart_rate: 90 } };
      const res = await repo.recordObservation(db, nurse, input, now);
      assert.deepEqual(res.document.recorded_by, { staff_id: 6 });
      await assert.rejects(repo.recordObservation(db, nurse, input, now), (e) => e.status === 409);
      await assert.rejects(
        repo.recordObservation(db, nurse, { ...input, observedAt: '2026-10-24T15:05:00+05:30', vitals: { spo2: 120 } }, now),
        (e) => e.status === 400 && e.details !== undefined,
      );
      await assert.rejects(repo.recordObservation(db, admin, input, now), (e) => e.status === 403);
    });

    await t.test('repository: incident numbers come from the counter', async () => {
      const input = {
        category: 'in_hospital', incidentType: 'patient_fall', caseIds: [9],
        occurredAt: '2026-10-24T15:10:00+05:30', reportedAt: '2026-10-24T15:20:00+05:30',
        location: { description: 'Ward bay 2' }, severity: 'low', harmLevel: 'none',
        summary: 'Patient slipped while walking, no injury found.',
      };
      const results = await Promise.all([1, 2, 3].map(() => repo.reportIncident(db, nurse, input, now)));
      assert.deepEqual(results.map((r) => r.document.incident_no).sort(), ['INC-2026-0009', 'INC-2026-0010', 'INC-2026-0011']);
      const counter = await db.collection('counters').findOne({ _id: 'incident_no:2026' });
      assert.equal(counter.seq, 11);
    });

    await t.test('repository: note lifecycle draft -> signed -> amended (pipeline update)', async () => {
      const { insertedId } = await repo.writeNote(db, doctor, { caseId: 9, noteType: 'progress', title: 'Progress: fall review', body: 'No injury.' }, now);
      await repo.signNote(db, doctor, { noteId: insertedId.toHexString() }, now);
      await assert.rejects(repo.deleteDraftNote(db, doctor, { noteId: insertedId }), (e) => e.status === 404);
      await repo.amendNote(db, doctor, { noteId: insertedId, newBody: 'No injury. Falls plan updated.', reason: 'Added falls plan' }, now);
      const note = await db.collection('clinical_notes').findOne({ _id: insertedId });
      assert.equal(note.status, 'amended');
      assert.equal(note.amendments[0].previous_body, 'No injury.');
    });

    await t.test('repository: close incident + review note in one transaction', async (tt) => {
      const hello = await db.admin().command({ hello: 1 });
      const args = { incidentNo: 'INC-2026-0007', caseId: 3, actions: ['Priority CT slot'], title: 'Incident review: CT delay', body: 'Reviewed with radiology lead.' };
      if (!hello.setName) {
        await assert.rejects(repo.closeIncidentWithNote(db, { role: 'doctor', doctor_id: 3 }, args, now), (e) => e.status === 501);
        assert.equal((await db.collection('incident_reports').findOne({ incident_no: 'INC-2026-0007' })).status, 'open');
        tt.diagnostic('standalone server: checked the 501 path; start mongod with --replSet to test the commit path');
        return;
      }
      // a note that fails validation must roll back the incident update too
      await assert.rejects(repo.closeIncidentWithNote(db, { role: 'doctor', doctor_id: 3 }, { ...args, title: 'x' }, now), (e) => e.status === 400);
      assert.equal((await db.collection('incident_reports').findOne({ incident_no: 'INC-2026-0007' })).status, 'open', 'rolled back');
      const res = await repo.closeIncidentWithNote(db, { role: 'doctor', doctor_id: 3 }, args, now);
      assert.equal(res.incident.modified, 1);
      assert.equal((await db.collection('incident_reports').findOne({ incident_no: 'INC-2026-0007' })).status, 'closed');
      assert.equal((await db.collection('clinical_notes').findOne({ 'links.incident_no': 'INC-2026-0007' })).status, 'signed');
    });

    await t.test('database roles are created with the generated privileges', async (tt) => {
      const { createRoles } = require('../scripts/create-roles');
      try {
        await createRoles(db, quiet);
      } catch (err) {
        // 13 Unauthorized (local --auth without userAdmin), 8000 AtlasError (Atlas manages roles in its UI)
        if (err.code === 13 || err.code === 8000) { tt.skip(`this server does not let the test user create roles: ${err.message}`); return; }
        throw err;
      }
      const { roles } = await db.command({ rolesInfo: 'hospital_er_admin', showPrivileges: true });
      assert.deepEqual(roles[0].privileges.map((p) => p.resource.collection), ['incident_reports']);
      const again = await createRoles(db, quiet);
      assert.ok(again.every((r) => r.action === 'updated'));
    });
  } finally {
    try {
      for (const role of ['hospital_er_app', 'hospital_er_doctor', 'hospital_er_nurse', 'hospital_er_admin']) {
        await db.command({ dropRole: role }).catch(() => {});
      }
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  }
});
