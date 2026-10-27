'use strict';

/**
 * Unit tests for the queries and pipelines (no MongoDB server needed).
 *  1. NEWS2 scoring matches the published RCP bands (hand-worked values)
 *  2. The generated MongoDB NEWS2 expressions give the same scores as the
 *     JavaScript scorer for every sample observation (via tests/helpers/mini-agg)
 *  3. The red-flag filter selects exactly the readings with a single score of 3
 *  4. The reference results (used for docs and integration tests) match
 *     numbers worked out by hand from the sample data
 *  5. Pipeline structure rules MongoDB enforces ($geoNear first, etc.)
 *  6. The generated mongosh file is up to date
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const news2 = require('../lib/news2');
const q = require('../lib/queries');
const { demos, SAMPLE_DAY, AS_OF, BOARD_TIME } = require('../lib/demos');
const { loadJsonDocuments } = require('../lib/load-json');
const { createReference } = require('./helpers/reference');
const { applySetStages, matches } = require('./helpers/mini-agg');
const { render, OUT_FILE } = require('../scripts/export-mongosh');
const docs = require('../scripts/generate-query-docs');

const observations = loadJsonDocuments(path.join(__dirname, '..', 'data', 'observation_logs.json'));
const ref = createReference();
const at = (caseId, hhmm) => observations.find(
  (o) => o.case_id === caseId && o.observed_at.getTime() === new Date(`2026-10-24T${hhmm}:00+05:30`).getTime(),
);

// ---- 1. NEWS2 bands --------------------------------------------------------

test('NEWS2 band edges match the RCP 2017 chart', () => {
  const s = news2.scoreParameter;
  // respiration rate: <=8:3, 9-11:1, 12-20:0, 21-24:2, >=25:3
  assert.deepEqual([8, 9, 11, 12, 20, 21, 24, 25].map((v) => s('resp_rate', v)), [3, 1, 1, 0, 0, 2, 2, 3]);
  // SpO2 scale 1: <=91:3, 92-93:2, 94-95:1, >=96:0
  assert.deepEqual([91, 92, 93, 94, 95, 96].map((v) => s('spo2', v)), [3, 2, 2, 1, 1, 0]);
  // systolic BP: <=90:3, 91-100:2, 101-110:1, 111-219:0, >=220:3
  assert.deepEqual([90, 91, 100, 101, 110, 111, 219, 220].map((v) => s('systolic', v)), [3, 2, 2, 1, 1, 0, 0, 3]);
  // pulse: <=40:3, 41-50:1, 51-90:0, 91-110:1, 111-130:2, >=131:3
  assert.deepEqual([40, 41, 50, 51, 90, 91, 110, 111, 130, 131].map((v) => s('heart_rate', v)), [3, 1, 1, 0, 0, 1, 1, 2, 2, 3]);
  // temperature: <=35.0:3, 35.1-36.0:1, 36.1-38.0:0, 38.1-39.0:1, >=39.1:2
  assert.deepEqual([35.0, 35.1, 36.0, 36.1, 38.0, 38.1, 39.0, 39.1].map((v) => s('temp_c', v)), [3, 1, 1, 0, 0, 1, 1, 2]);
  assert.equal(s('on_supplemental_o2', true), 2);
  assert.equal(s('on_supplemental_o2', false), 0);
  assert.deepEqual(['A', 'C', 'V', 'P', 'U'].map((v) => s('consciousness', v)), [0, 3, 3, 3, 3]);
});

test('NEWS2 totals for sample readings match hand calculation', () => {
  const cases = [
    // [case, time, total, risk]  - worked by hand from the RCP chart
    [1, '08:17', 7, 'high'], // RR22=2 SpO2 94=1 O2=2 SBP146=0 HR112=2 A=0 36.9=0
    [2, '08:42', 8, 'high'], // RR22=2 96=0 air SBP98=2 HR112=2 A 39.2=2
    [3, '09:07', 4, 'low-medium'], // HR92=1 + new confusion (C)=3 -> single 3
    [5, '10:12', 5, 'medium'], // RR22=2 SBP102=1 HR108=1 38.2=1
    [8, '12:02', 8, 'high'], // RR24=2 93=2 O2=2 HR118=2
    [8, '12:30', 10, 'high'], // RR32=3 89=3 O2=2 HR128=2
    [8, '13:00', 6, 'medium'], // RR24=2 94=1 O2=2 HR110=1
    [8, '14:00', 3, 'low'], // O2=2 HR98=1
  ];
  for (const [caseId, time, total, risk] of cases) {
    const r = news2.scoreObservation(at(caseId, time));
    assert.equal(r.total, total, `case ${caseId} ${time}`);
    assert.equal(r.risk, risk, `case ${caseId} ${time}`);
  }
});

test('observations missing a NEWS2 parameter are not scored', () => {
  const pre = at(8, '11:42'); // prehospital, no temperature recorded
  assert.equal(pre.vitals.temp_c, undefined);
  const r = news2.scoreObservation(pre);
  assert.equal(r.total, null);
  assert.equal(r.components.temp_c, null);
});

// ---- 2 + 3. generated MongoDB expressions ---------------------------------

test('generated MongoDB NEWS2 stages agree with the JavaScript scorer on all 32 observations', () => {
  const stages = news2.news2Stages();
  for (const o of observations) {
    const viaPipeline = applySetStages(stages, o).news2;
    const viaJs = news2.scoreObservation(o);
    assert.deepEqual(viaPipeline.components, viaJs.components, `case ${o.case_id} ${o.observed_at.toISOString()}`);
    assert.equal(viaPipeline.total, viaJs.total);
    assert.equal(viaPipeline.max_single, viaJs.max_single);
    assert.equal(viaPipeline.risk, viaJs.risk);
  }
});

test('red-flag filter selects exactly the readings with a single NEWS2 score of 3', () => {
  const filter = news2.redScoreFilter();
  const viaFilter = observations.filter((o) => matches(filter, o));
  const viaScores = observations.filter((o) => Object.values(news2.scoreObservation(o).components).includes(3));
  assert.deepEqual(viaFilter, viaScores);
  assert.ok(viaFilter.length > 0);
});

// ---- 4. reference results vs hand-worked numbers -------------------------

test('F2 red flags: case 3 confusion and case 8 breathing readings are flagged', () => {
  const rows = ref.redFlagObservations(SAMPLE_DAY);
  const keys = rows.map((r) => `${r.case_id}@${r.observed_at.toISOString().slice(11, 16)}`);
  // newest first; times are UTC (12:30 IST = 07:00Z)
  assert.deepEqual(keys, [
    '8@07:00', // 12:30 IST  RR 32, SpO2 89 on oxygen
    '8@06:20', // 11:50 IST  RR 28 (prehospital)
    '8@06:12', // 11:42 IST  RR 30, SpO2 89 (prehospital)
    '3@03:37', // 09:07 IST  new confusion
    '3@03:22', // 08:52 IST  new confusion (prehospital)
  ]);
});

test('F3 work queue: INC-2026-0005 and INC-2026-0007, newest first', () => {
  assert.deepEqual(ref.openIncidents().map((i) => i.incident_no), ['INC-2026-0005', 'INC-2026-0007']);
});

test('F4 case 3 has an ambulance incident and an in-hospital incident', () => {
  assert.deepEqual(ref.incidentsForCase(3).map((i) => i.incident_no), ['INC-2026-0002', 'INC-2026-0007']);
});

test('F6 draft queue: case 1 progress note, then case 5', () => {
  assert.deepEqual(ref.draftNotesQueue().map((n) => n.case_id), [1, 5]);
});

test('A1 NEWS2 board at 12:45: case 8 on top with a +2 deterioration', () => {
  const board = ref.news2Board({ from: SAMPLE_DAY.from, to: BOARD_TIME });
  assert.deepEqual(board.map((r) => r.case_id), [8, 2, 5, 7, 9, 1, 3, 6, 4]); // case 10 arrived later
  const top = board[0];
  assert.deepEqual(
    { score: top.latest.score, risk: top.latest.risk, change: top.latest.change, peak: top.peak_score },
    { score: 10, risk: 'high', change: 2, peak: 10 },
  );
  assert.deepEqual(top.history.map((h) => h.score), [8, 10]);
  assert.deepEqual(board.filter((r) => r.deterioration_detected).map((r) => r.case_id), [8]);
  assert.deepEqual(board.map((r) => r.peak_score), [10, 8, 5, 2, 1, 7, 4, 4, 1]);
});

test('A2 response times match the timelines (minutes worked by hand)', () => {
  const r = ref.responseTimes({ targetMinutes: 15, ...SAMPLE_DAY });
  const byNo = Object.fromEntries(r.incidents.map((i) => [i.incident_no, i.minutes]));
  const row = (a, b, c, d, e) => ({ call_to_dispatch: a, call_to_scene: b, at_scene: c, transport: d, call_to_hospital: e });
  assert.deepEqual(byNo, {
    'INC-2026-0001': row(2, 11, 7, 9, 27),
    'INC-2026-0002': row(2, 12, 7, 8, 27),
    'INC-2026-0003': row(3, 13, 8, 11, 32),
    'INC-2026-0004': row(2, 15, 7, 8, 30),
    'INC-2026-0005': row(2, 16, 8, 12, 36),
  });
  assert.deepEqual(r.summary, {
    incidents: 5, avg_call_to_scene: 13.4, max_call_to_scene: 16, avg_at_scene: 7.4,
    avg_transport: 9.6, avg_call_to_hospital: 30.4, target_breaches: 1,
  });
  assert.deepEqual(r.incidents.filter((i) => i.target_breached).map((i) => i.incident_no), ['INC-2026-0005']);
  assert.deepEqual(r.by_severity, [
    { severity: 'critical', incidents: 1, avg_call_to_scene: 16 },
    { severity: 'high', incidents: 2, avg_call_to_scene: 11.5 },
    { severity: 'moderate', incidents: 2, avg_call_to_scene: 14 },
  ]);
});

test('A3 incident trends match counts by hand', () => {
  const t = ref.incidentTrends({ ...SAMPLE_DAY, asOf: AS_OF });
  assert.equal(t.total, 8);
  assert.deepEqual(t.by_status, [
    { status: 'closed', incidents: 6 }, { status: 'open', incidents: 1 }, { status: 'under_review', incidents: 1 },
  ]);
  assert.deepEqual(t.by_severity.map((s) => [s.severity, s.incidents]), [['critical', 1], ['high', 2], ['low', 2], ['moderate', 3]]);
  assert.deepEqual(t.by_hour.map((h) => [h.hour, h.incidents]), [[7, 1], [8, 2], [9, 3], [11, 2]]);
  assert.deepEqual(t.by_day, [{ day: '2026-10-24', incidents: 8 }]);
  assert.deepEqual(t.in_hospital_harm, [{ harm_level: 'none', incidents: 3 }]);
  // reported 10:05 and 11:24 IST; "now" 18:00 IST -> UTC hour boundaries 04->12 and 05->12
  assert.deepEqual(t.open_items.map((o) => [o.incident_no, o.hours_open]), [['INC-2026-0007', 8], ['INC-2026-0005', 7]]);
});

test('A4 hotspot distances are plausible and banded correctly', () => {
  const h = ref.incidentHotspots({ maxKm: 30 });
  // rough flat-earth estimates worked by hand, +-0.25 km
  const approx = { 'INC-2026-0001': 4.4, 'INC-2026-0004': 6.0, 'INC-2026-0002': 7.1, 'INC-2026-0003': 8.3, 'INC-2026-0005': 16.8 };
  assert.deepEqual(h.nearest.map((n) => n.incident_no), Object.keys(approx));
  for (const n of h.nearest) assert.ok(Math.abs(n.distance_km - approx[n.incident_no]) <= 0.25, `${n.incident_no}: ${n.distance_km}`);
  assert.deepEqual(h.by_distance_band.map((b) => [b.band_km, b.incidents]), [['0-5', 1], ['5-10', 3], ['10-20', 1]]);
  assert.equal(ref.incidentHotspots({ maxKm: 5 }).nearest.length, 1);
});

test('A5 vitals summary for case 8', () => {
  const s = ref.vitalsSummary().find((r) => r.case_id === 8);
  assert.deepEqual(
    { n: s.observations, sources: s.sources, mins: s.monitored_minutes, spo2: s.lowest_spo2, rr: s.highest_resp_rate, o2: s.oxygen_readings, hr: s.heart_rate },
    { n: 6, sources: ['prehospital', 'triage', 'ward'], mins: 138, spo2: 89, rr: 32, o2: 5, hr: { min: 98, max: 128, avg: 116.3 } },
  );
  assert.equal(ref.vitalsSummary().length, 10);
});

test('A6 case 8 timeline merges 6 observations, 2 notes and 1 incident in order', () => {
  const t = ref.caseTimeline(8);
  assert.equal(t.length, 9);
  assert.deepEqual(t.map((e) => e.kind), [
    'incident', 'observation', 'observation', 'observation', 'note', 'observation', 'note', 'observation', 'observation',
  ]);
  assert.equal(t[1].summary, 'HR 124, RR 30, SpO2 89%, BP 132/84');
  assert.equal(t[2].summary, 'HR 120, RR 28, SpO2 92% on O2, BP 130/82');
});

// ---- 5. pipeline structure -----------------------------------------------

test('every aggregate demo is a well-formed pipeline', () => {
  const STAGES = new Set(['$match', '$set', '$setWindowFields', '$sort', '$group', '$project', '$facet', '$geoNear', '$unionWith']);
  for (const d of demos.filter((x) => x.type === 'aggregate')) {
    const { pipeline } = d.build();
    for (const stage of pipeline) {
      const keys = Object.keys(stage);
      assert.equal(keys.length, 1, `${d.id}: a stage must have exactly one operator`);
      assert.ok(STAGES.has(keys[0]), `${d.id}: unexpected stage ${keys[0]}`);
    }
  }
});

test('$geoNear is the first stage of the hotspot pipeline (MongoDB requirement)', () => {
  const { pipeline } = q.incidentHotspots();
  assert.ok('$geoNear' in pipeline[0]);
  assert.equal(pipeline.filter((s) => '$geoNear' in s).length, 1);
});

test('text search sorts by relevance and projects the score', () => {
  const s = q.searchNotes('oxygen');
  assert.deepEqual(s.projection.score, { $meta: 'textScore' });
  assert.deepEqual(Object.keys(s.sort)[0], 'score');
  assert.throws(() => q.searchNotes(' '), /at least 2 characters/);
});

test('builders reject bad IDs instead of querying with them', () => {
  for (const bad of [0, -1, 1.5, '8', null, undefined]) {
    assert.throws(() => q.observationsForCase(bad), /positive integer/);
    assert.throws(() => q.caseTimeline(bad), /positive integer/);
  }
});

test('amendNote keeps user text literal and archives the old body', () => {
  const u = q.amendNote({ noteId: 'id', newBody: '$body', reason: '$where', amendedBy: { doctor_id: 4 } });
  const set = u.update[0].$set;
  assert.deepEqual(set.body, { $literal: '$body' });
  assert.equal(set.amendments.$concatArrays[1][0].previous_body, '$body');
  assert.deepEqual(set.amendments.$concatArrays[1][0].reason, { $literal: '$where' });
  assert.deepEqual(u.filter.status, { $in: ['signed', 'amended'] });
});

test('closeIncident only matches incidents that are not already closed', () => {
  const u = q.closeIncident({ incidentNo: 'INC-2026-0007', reviewedBy: { doctor_id: 3 } });
  assert.deepEqual(u.filter, { incident_no: 'INC-2026-0007', status: { $ne: 'closed' } });
  assert.equal(u.update.$set.status, 'closed');
  assert.throws(() => q.closeIncident({ incidentNo: 'x', reviewedBy: { doctor_id: 1, staff_id: 2 } }), /reviewedBy/);
});

// ---- 6. generated file -----------------------------------------------------

test('queries/queries.mongosh.js is up to date (run npm run export:mongosh)', () => {
  assert.equal(fs.readFileSync(OUT_FILE, 'utf8'), render());
});

test('docs/QUERIES.md is up to date (run npm run docs:queries)', () => {
  assert.equal(fs.readFileSync(docs.OUT_FILE, 'utf8'), docs.render());
});
