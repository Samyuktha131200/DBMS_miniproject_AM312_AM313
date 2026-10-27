'use strict';

/**
 * Cross-database consistency checks (no MongoDB server needed).
 * The MongoDB sample data only stores MySQL IDs, so these tests read
 * ../../02_sample_data.sql and confirm that:
 *  - every referenced case / doctor / staff / treatment / test / prescription exists
 *  - linked rows belong to the same case as the note
 *  - times agree with EMERGENCY_CASE.arrival_time and arrival_mode
 *  - no MySQL data (names, phone numbers...) has been copied into MongoDB
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadJsonDocuments } = require('../lib/load-json');

const SQL_FILE = path.join(__dirname, '..', '..', '02_sample_data.sql');
const DATA = path.join(__dirname, '..', 'data');
const load = (name) => loadJsonDocuments(path.join(DATA, `${name}.json`));

/** Rows of `INSERT INTO <table> (...) VALUES (...),(...);` as objects. */
function sqlRows(sql, table) {
  const m = sql.match(new RegExp(`INSERT INTO ${table}\\s*\\(([^)]*)\\)\\s*VALUES([\\s\\S]*?);`));
  if (!m) throw new Error(`no INSERT for ${table}`);
  const cols = m[1].split(',').map((c) => c.trim());
  const rows = [];
  for (const tuple of m[2].matchAll(/\(((?:[^()']|'[^']*')*)\)/g)) {
    const values = [...tuple[1].matchAll(/'([^']*)'|(NULL)|(-?[\d.]+)/g)].map((v) =>
      v[1] !== undefined ? v[1] : v[2] ? null : Number(v[3]),
    );
    rows.push(Object.fromEntries(cols.map((c, i) => [c, values[i]])));
  }
  return rows;
}

const haveSql = fs.existsSync(SQL_FILE);
const skip = haveSql ? false : `MySQL sample data not found at ${SQL_FILE}`;

let mysql;
if (haveSql) {
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  // MySQL DATETIME values are local hospital time (IST, +05:30)
  const ist = (s) => new Date(`${s.replace(' ', 'T')}+05:30`);
  mysql = {
    cases: new Map(sqlRows(sql, 'EMERGENCY_CASE').map((r) => [r.case_id, { ...r, arrival: ist(r.arrival_time) }])),
    doctors: new Set(sqlRows(sql, 'DOCTOR').map((r) => r.doctor_id)),
    staff: new Set(sqlRows(sql, 'NURSE_STAFF').map((r) => r.staff_id)),
    treatments: new Map(sqlRows(sql, 'TREATMENT').map((r) => [r.treatment_id, r.case_id])),
    testOrders: new Map(sqlRows(sql, 'TEST_ORDER').map((r) => [r.test_order_id, r.case_id])),
    prescriptions: new Map(sqlRows(sql, 'PRESCRIPTION').map((r) => [r.prescription_id, r.case_id])),
  };
}

const incidents = load('incident_reports');
const observations = load('observation_logs');
const notes = load('clinical_notes');

function assertPerson(ref, where) {
  if (ref.doctor_id !== undefined) assert.ok(mysql.doctors.has(ref.doctor_id), `${where}: unknown doctor_id ${ref.doctor_id}`);
  if (ref.staff_id !== undefined) assert.ok(mysql.staff.has(ref.staff_id), `${where}: unknown staff_id ${ref.staff_id}`);
}

test('every case_id exists in MySQL EMERGENCY_CASE', { skip }, () => {
  for (const d of incidents) for (const c of d.case_ids) assert.ok(mysql.cases.has(c), `${d.incident_no}: case ${c}`);
  for (const d of observations) assert.ok(mysql.cases.has(d.case_id), `observation case ${d.case_id}`);
  for (const d of notes) assert.ok(mysql.cases.has(d.case_id), `note "${d.title}" case ${d.case_id}`);
});

test('every doctor_id / staff_id exists in MySQL', { skip }, () => {
  for (const d of incidents) {
    assertPerson(d.reported_by, d.incident_no);
    if (d.follow_up?.reviewed_by) assertPerson(d.follow_up.reviewed_by, `${d.incident_no} reviewer`);
  }
  for (const d of observations) assertPerson(d.recorded_by, `observation case ${d.case_id}`);
  for (const d of notes) {
    assertPerson(d.author, d.title);
    for (const a of d.amendments || []) assertPerson(a.amended_by, `${d.title} amendment`);
  }
});

test('note links point to rows of the same case', { skip }, () => {
  const incidentByNo = new Map(incidents.map((i) => [i.incident_no, i]));
  for (const n of notes) {
    const l = n.links || {};
    for (const [field, table] of [
      ['treatment_id', mysql.treatments],
      ['test_order_id', mysql.testOrders],
      ['prescription_id', mysql.prescriptions],
    ]) {
      if (l[field] === undefined) continue;
      assert.ok(table.has(l[field]), `${n.title}: ${field} ${l[field]} not in MySQL`);
      assert.equal(table.get(l[field]), n.case_id, `${n.title}: ${field} ${l[field]} belongs to another case`);
    }
    if (l.incident_no) {
      const inc = incidentByNo.get(l.incident_no);
      assert.ok(inc, `${n.title}: unknown incident ${l.incident_no}`);
      assert.ok(inc.case_ids.includes(n.case_id), `${n.title}: incident ${l.incident_no} is for other cases`);
    }
  }
});

test('prehospital records only exist for ambulance arrivals and end at arrival_time', { skip }, () => {
  for (const d of incidents.filter((i) => i.category === 'prehospital')) {
    for (const c of d.case_ids) {
      const kase = mysql.cases.get(c);
      assert.equal(kase.arrival_mode, 'Ambulance', `${d.incident_no}: case ${c} was not an ambulance arrival`);
      const arrived = d.timeline.find((e) => e.event === 'arrived_hospital');
      assert.ok(arrived, `${d.incident_no}: no arrived_hospital event`);
      assert.equal(arrived.at.getTime(), kase.arrival.getTime(), `${d.incident_no}: arrival time differs from MySQL`);
    }
  }
  for (const o of observations) {
    const kase = mysql.cases.get(o.case_id);
    if (o.source === 'prehospital') {
      assert.equal(kase.arrival_mode, 'Ambulance', `prehospital obs for walk-in case ${o.case_id}`);
      assert.ok(o.observed_at < kase.arrival, `prehospital obs for case ${o.case_id} after arrival`);
    } else {
      assert.ok(o.observed_at >= kase.arrival, `${o.source} obs for case ${o.case_id} before arrival`);
    }
  }
});

test('notes are written after the patient arrived', { skip }, () => {
  for (const n of notes) {
    assert.ok(n.created_at >= mysql.cases.get(n.case_id).arrival, `${n.title} predates arrival`);
  }
});

test('timelines and timestamps are in chronological order', () => {
  for (const d of incidents) {
    const times = d.timeline.map((e) => e.at.getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b), `${d.incident_no} timeline out of order`);
    assert.ok(d.reported_at >= d.occurred_at, `${d.incident_no}: reported before it occurred`);
    assert.ok(d.updated_at >= d.created_at, `${d.incident_no}: updated before created`);
  }
  for (const n of notes) {
    assert.ok(n.updated_at >= n.created_at, `${n.title}: updated before created`);
    if (n.signed_at) assert.ok(n.signed_at >= n.created_at, `${n.title}: signed before written`);
  }
});

test('no MySQL data is duplicated into MongoDB documents', () => {
  // columns that belong to MySQL tables and must only be referenced by ID
  const forbidden = new Set([
    'first_name', 'last_name', 'dob', 'gender', 'blood_group', 'phone', 'address',
    'emergency_contact_name', 'emergency_contact_phone', 'name', 'specialization',
    'vehicle_number', 'driver_name', 'driver_phone', 'ambulance_id', 'bed_id',
    'ward_type', 'medicine_name', 'dept_name', 'triage_level', 'case_status',
    'arrival_mode', 'chief_complaint', 'total_amount', 'payment_status',
  ]);
  const walk = (value, where) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${where}[${i}]`));
    else if (value && typeof value === 'object' && !(value instanceof Date)) {
      for (const [k, v] of Object.entries(value)) {
        assert.ok(!forbidden.has(k), `${where}.${k} duplicates a MySQL column`);
        walk(v, `${where}.${k}`);
      }
    }
  };
  walk(incidents, 'incident_reports');
  walk(observations, 'observation_logs');
  walk(notes, 'clinical_notes');
});

test('observation keys are unique per (case_id, observed_at, source)', () => {
  // mirrors the unique index uniq_case_observed_source
  const keys = observations.map((o) => `${o.case_id}|${o.observed_at.toISOString()}|${o.source}`);
  assert.equal(new Set(keys).size, keys.length);
});
