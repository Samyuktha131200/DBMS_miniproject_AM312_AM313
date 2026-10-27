'use strict';

/**
 * Writes docs/QUERIES.md: purpose, MongoDB features, exact query and
 * expected output for every demo. The query text comes from the same
 * builders the app runs; the expected output comes from the independent
 * plain-JavaScript reference in tests/helpers/reference.js.
 *
 *   npm run docs:queries
 */

const fs = require('node:fs');
const path = require('node:path');
const { demos, WRITE_TYPES, SAMPLE_DAY, AS_OF, BOARD_TIME } = require('../lib/demos');
const { BANDS, RISK_LEVELS } = require('../lib/news2');
const { HOSPITAL_LOCATION, RESPONSE_TARGET_MIN } = require('../lib/queries');
const { compactJson } = require('../lib/format');
const { toJs } = require('./export-mongosh');
const { createReference } = require('../tests/helpers/reference');

const OUT_FILE = path.join(__dirname, '..', 'docs', 'QUERIES.md');
const ref = createReference();

/** Docs-only details per demo: features used, index, expected output, notes. */
const DETAILS = {
  'case-observations': {
    features: ['equality filter', 'sort', 'projection'],
    index: 'uniq_case_observed_source',
    expected: () => ref.observationsForCase(8),
    show: 2,
  },
  'red-flags': {
    features: ['`$or` of range conditions on nested fields', 'date range', 'sort'],
    index: 'observed_at (date range), then filter',
    expected: () => ref.redFlagObservations(SAMPLE_DAY),
    show: 2,
    notes: 'The `$or` list is generated from the NEWS2 band table in `lib/news2.js`, so it always matches the scoring used in A1.',
  },
  'open-incidents': {
    features: ['`$in`', 'sort'],
    index: 'status_occurred',
    expected: () => ref.openIncidents(),
  },
  'case-incidents': {
    features: ['query on an array field (multikey index)'],
    index: 'case_ids',
    expected: () => ref.incidentsForCase(3).map(({ incident_no, category, incident_type, severity, status }) => ({ incident_no, category, incident_type, severity, status })),
    notes: 'Expected output shows only the main fields; the query returns full documents.',
  },
  'search-notes': {
    features: ['`$text` search with stemming ("breathlessness" matches "breathless")', 'relevance score via `$meta: "textScore"`', 'field weights'],
    index: 'notes_text',
    expectedText: 'Five notes, highest relevance first. The exact scores depend on MongoDB\'s text scoring, so only the set of titles is fixed:\n\n- Assessment: acute breathlessness (case 8)\n- Escalation: increased work of breathing (case 8)\n- Triage: central chest pain (case 1)\n- Cardiology assessment (case 1)\n- Progress: pain settling (case 1)',
  },
  'draft-queue': {
    features: ['partial index (only drafts are indexed)'],
    index: 'draft_queue',
    expected: () => ref.draftNotesQueue(),
  },
  'news2-board': {
    features: ['`$switch` scoring expressions', '`$setWindowFields` + `$shift` (previous reading per patient)', '`$group` with `$last`, `$max`, `$push`', 'multi-key `$sort`'],
    index: 'observed_at',
    expected: () => ref.news2Board({ from: SAMPLE_DAY.from, to: BOARD_TIME }),
    show: 3,
    notes: 'Readings without all seven NEWS2 parameters (e.g. ambulance readings with no temperature) are not scored. Case 8 rose from 8 to 10 between triage and the 12:30 ward reading, so `deterioration_detected` is true. That matches the escalation note written at 12:32.',
  },
  'response-times': {
    features: ['`$arrayToObject` + `$map` (timeline array to named timestamps)', '`$dateDiff`', '`$facet` (rows + summary in one query)', '`$round`'],
    expected: () => [ref.responseTimes({ targetMinutes: RESPONSE_TARGET_MIN, ...SAMPLE_DAY })],
    trim: (r) => [{ ...r[0], incidents: [r[0].incidents[0], `... ${r[0].incidents.length - 1} more`] }],
    notes: 'INC-2026-0005 took 16 minutes from call to scene, over the 15-minute target. That is why it is "under_review" in the incident data.',
  },
  'incident-trends': {
    features: ['`$facet` with eight sub-pipelines', '`$hour` and `$dateToString` with an IST time zone', '`$count`', '`$dateDiff` in hours'],
    expected: () => [ref.incidentTrends({ ...SAMPLE_DAY, asOf: AS_OF })],
    notes: '`hours_open` is measured to the fixed demo time 18:00 IST; the API passes the current time.',
  },
  hotspots: {
    features: ['`$geoNear` (must be the first stage)', 'GeoJSON points', '`$bucket` distance bands', '`$facet`'],
    index: 'location_geo_2dsphere',
    expected: () => [ref.incidentHotspots({ maxKm: 30 })],
    notes: `Distances are measured from the (fictional) hospital location ${JSON.stringify(HOSPITAL_LOCATION.coordinates)} [longitude, latitude] and rounded to 0.1 km. In-hospital incidents have no coordinates and are not included.`,
  },
  'vitals-summary': {
    features: ['`$group` with `$min`, `$max`, `$avg`, `$first`, `$last`, `$addToSet`', '`$sortArray`', '`$dateDiff`'],
    expected: () => ref.vitalsSummary(),
    show: 2,
  },
  'case-timeline': {
    features: ['`$unionWith` (three collections in one result)', '`$concat` + `$toString` to build readable summaries', '`$literal`'],
    expected: () => ref.caseTimeline(8),
  },
  'close-incident': {
    features: ['`$set` on nested fields', '`$push` with `$each`', 'filter that only matches open incidents'],
    expectedText: 'First run: `{ matchedCount: 1, modifiedCount: 1 }`. INC-2026-0007 becomes `status: "closed"`, with `follow_up.reviewed_by: { doctor_id: 3 }`, the action listed, and a final `{ event: "closed" }` timeline entry. Running it again matches nothing (`matchedCount: 0`).',
  },
  'sign-note': {
    features: ['conditional update (only drafts match)'],
    expectedText: 'First run: `{ matchedCount: 1, modifiedCount: 1 }`. The case 5 progress note gets `status: "signed"` and `signed_at`. A second run matches nothing.',
  },
  'record-observation': {
    features: ['`insertOne` checked by the `$jsonSchema` validator', 'unique index `uniq_case_observed_source` blocks duplicates'],
    expectedText: '`{ acknowledged: true, insertedId: ObjectId(...) }`. Case 5 now has a 15:00 ward reading. Running it a second time fails with duplicate-key error 11000; changing `spo2` to 120 fails with validation error 121.',
  },
  'report-incident': {
    features: ['`insertOne`', 'category-specific `oneOf` rule (in-hospital incidents need `harm_level`)'],
    expectedText: '`{ acknowledged: true, insertedId: ObjectId(...) }`. INC-2026-0009 is stored with `status: "open"`, `created_at` and `updated_at` set. The unique index `uniq_incident_no` rejects a second report with the same number.',
  },
  'write-note': {
    features: ['`insertOne`', 'notes always start as `status: "draft"`', 'link to an incident report via `links.incident_no`'],
    expectedText: '`{ acknowledged: true, insertedId: ObjectId(...) }`. The note is stored as a draft and appears in the F6 sign-off queue and in F5 text search (e.g. searching "fall").',
  },
  'start-review': {
    features: ['`$set` + `$push` in one update', 'status can only move forward (filter matches `open` only)'],
    expectedText: 'First run: `{ matchedCount: 1, modifiedCount: 1 }`. INC-2026-0007 becomes `status: "under_review"` with a `{ event: "reviewed" }` timeline entry. A second run matches nothing. U1 can then close it.',
  },
  'edit-draft': {
    features: ['filter on `status` and `author` (only your own drafts)'],
    expectedText: '`{ matchedCount: 1, modifiedCount: 1 }`. The case 1 draft gets the new body and `updated_at`. With `author: { doctor_id: 1 }` (someone else) it matches nothing.',
  },
  'delete-draft': {
    features: ['`deleteOne` with a filter on `status` and `author`'],
    expectedText: '`{ deletedCount: 1 }`. Case 1 goes from 3 notes to 2. The same filter against a signed note deletes nothing (`deletedCount: 0`).',
  },
  'delete-observation': {
    features: ['`deleteOne` by natural key (the unique index)', 'only the person who recorded it'],
    expectedText: 'After C1: `{ deletedCount: 1 }` and case 5 is back to its original 4 observations. Without C1 first: `{ deletedCount: 0 }`.',
  },
  'purge-incidents': {
    features: ['`deleteMany` with a range filter', 'open and under-review incidents never match'],
    expectedText: '`{ deletedCount: 2 }` (INC-2026-0001 and INC-2026-0002, both closed and last updated before 09:15). The collection goes from 8 incidents to 6 (9 to 7 if C2 ran first).',
  },
  'amend-note': {
    features: ['update with an aggregation pipeline (atomic read-modify-write)', '`$concatArrays`', '`$literal` for user-supplied text'],
    expectedText: '`{ matchedCount: 1, modifiedCount: 1 }`. The note gets `status: "amended"`, the new text in `body`, and one `amendments` entry whose `previous_body` holds the original text ("...Fracture clinic follow-up arranged.").',
  },
};

const code = (lang, text) => `\`\`\`${lang}\n${text}\n\`\`\``;

function queryText(demo) {
  const query = demo.build();
  const c = `db.${query.collection}`;
  if (demo.type === 'find') {
    return `${c}.find(\n  ${toJs(query.filter, {}, 1)},\n  ${toJs(query.projection, {}, 1)}\n).sort(${toJs(query.sort, {}, 0)})`;
  }
  if (demo.type === 'aggregate') return `${c}.aggregate(${toJs(query.pipeline, {}, 0)})`;
  if (demo.type === 'insert') return `${c}.insertOne(${toJs(query.document, { ints: true }, 0)})`;
  if (demo.type === 'delete') return `${c}.${query.many ? 'deleteMany' : 'deleteOne'}(${toJs(query.filter, { ints: true }, 0)})`;
  return `${c}.updateOne(\n  ${toJs(query.filter, { ints: true }, 1)},\n  ${toJs(query.update, { ints: true }, 1)}\n)`;
}

function expectedText(demo, d) {
  if (d.expectedText) return d.expectedText;
  let result = d.expected();
  const total = result.length;
  if (d.trim) result = d.trim(result);
  else if (d.show && total > d.show) result = [...result.slice(0, d.show), `... ${total - d.show} more`];
  return `${total === 1 && demo.type === 'aggregate' ? '1 document' : `${total} documents`}${d.show && total > d.show ? ` (first ${d.show} shown)` : ''}:\n\n${code('json', compactJson(result))}`;
}

function renderDemo(demo) {
  const d = DETAILS[demo.id];
  const lines = [
    `${WRITE_TYPES.includes(demo.type) ? '####' : '###'} ${demo.title}`,
    '',
    `**Purpose.** ${demo.purpose}`,
    '',
    `**MongoDB features:** ${d.features.join(', ')}.`,
  ];
  if (d.index) lines.push('', `**Index used:** \`${d.index}\``);
  lines.push('', `Run it: \`npm run queries -- ${demo.id}${WRITE_TYPES.includes(demo.type) ? ' --updates' : ''}\``);
  lines.push('', '<details><summary>Query</summary>', '', code('js', queryText(demo)), '', '</details>');
  lines.push('', `**Expected output.** ${expectedText(demo, d)}`);
  if (d.notes) lines.push('', d.notes);
  return lines.join('\n');
}

function newsTable() {
  // integer bands step by 1, temperature by 0.1: "≤ 8 · 9–11 · ... · ≥ 25"
  const fmt = (bands, step = 1) => {
    const n = (x) => (step === 1 ? String(x) : x.toFixed(1));
    return bands.map(([upper, pts], i) => {
      const lo = i === 0 ? null : bands[i - 1][0] + step;
      const range = i === 0 ? `≤ ${n(upper)}` : upper === null ? `≥ ${n(lo)}` : `${n(lo)}–${n(upper)}`;
      return `${range}: **${pts}**`;
    }).join(' · ');
  };
  return [
    '| Parameter | Bands (value: points) |',
    '|---|---|',
    `| Respiration rate (/min) | ${fmt(BANDS.resp_rate)} |`,
    `| SpO2 Scale 1 (%) | ${fmt(BANDS.spo2)} |`,
    '| Supplemental oxygen | yes: **2** · no: **0** |',
    `| Systolic BP (mmHg) | ${fmt(BANDS.systolic)} |`,
    `| Pulse (/min) | ${fmt(BANDS.heart_rate)} |`,
    '| Consciousness (ACVPU) | Alert: **0** · new Confusion, Voice, Pain, Unresponsive: **3** |',
    `| Temperature (°C) | ${fmt(BANDS.temp_c, 0.1)} |`,
  ].join('\n');
}

function render() {
  const section = (type) => demos.filter((x) => x.type === type).map(renderDemo).join('\n\n');
  const index = demos.map((x) => `| \`${x.id}\` | ${x.type} | ${x.title.replace(/^\w+\. /, '')} |`).join('\n');
  return `<!-- GENERATED FILE - edit scripts/generate-query-docs.js and run: npm run docs:queries -->

# MongoDB queries and aggregation pipelines

Every query below is defined once in \`lib/queries.js\` and used by the demo
runner, the generated mongosh file (\`queries/queries.mongosh.js\`) and the
API. The **expected output** for each query is computed from the sample data
by a separate plain-JavaScript implementation (\`tests/helpers/reference.js\`),
not by MongoDB. The integration tests check that MongoDB returns exactly the same.

Times are shown in IST (+05:30). MongoDB stores them in UTC.

## How to run

\`\`\`bash
npm run queries                      # all read queries with results
npm run queries -- --list            # list query ids
npm run queries -- news2-board       # one query
npm run queries -- --explain         # also show which index each query used
npm run queries -- --updates         # also run the C, U and D write demos (changes data; reseed afterwards)
npm run seed -- --reset              # restore the sample data
mongosh "mongodb://localhost:27017" queries/queries.mongosh.js   # same queries in mongosh
\`\`\`

Needs MongoDB 6.0 or newer.

| id | type | query |
|---|---|---|
${index}

## NEWS2 early-warning score (used by F2 and A1)

NEWS2 is the National Early Warning Score 2 (Royal College of Physicians, 2017). Each of seven vital signs gets 0 to 3 points, and the points are added up. The bands live in one table in \`lib/news2.js\`. The MongoDB \`$switch\` expressions, the red-flag filter and the JavaScript scorer are all generated from it, so they cannot disagree.

${newsTable()}

| Total | Risk | Response |
|---|---|---|
| 0–4 | low | ${RISK_LEVELS.low.split(': ')[1]} |
| 0–4 with any single 3 | low-medium | ${RISK_LEVELS['low-medium'].split(': ')[1]} |
| 5–6 | medium | ${RISK_LEVELS.medium.split(': ')[1]} |
| 7+ | high | ${RISK_LEVELS.high.split(': ')[1]} |

This is a teaching implementation for a database project, not a clinical tool.

## Find queries (filtering and sorting)

${section('find')}

## Aggregation pipelines

${section('aggregate')}

## Writes: insert, update, delete

These change data. Run them with \`--updates\` and restore the sample data afterwards with \`npm run seed -- --reset\`.
They run in the order listed; D2 removes the reading C1 adds, and U4 moves INC-2026-0007 to review before U1 closes it.

Clinical records are kept, not deleted, so deletes are limited to unsigned drafts (D1), readings entered in error (D2) and expired closed incidents (D3). Signed notes can only be amended (U3).

### Inserts

${section('insert')}

### Updates

${section('update')}

### Deletes

${section('delete')}
`;
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, render());
  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}`);
}

module.exports = { render, OUT_FILE };
