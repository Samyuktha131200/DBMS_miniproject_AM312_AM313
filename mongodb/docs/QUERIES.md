<!-- GENERATED FILE - edit scripts/generate-query-docs.js and run: npm run docs:queries -->

# MongoDB queries and aggregation pipelines

Every query below is defined once in `lib/queries.js` and used by the demo
runner, the generated mongosh file (`queries/queries.mongosh.js`) and the
API. The **expected output** for each query is computed from the sample data
by a separate plain-JavaScript implementation (`tests/helpers/reference.js`),
not by MongoDB. The integration tests check that MongoDB returns exactly the same.

Times are shown in IST (+05:30). MongoDB stores them in UTC.

## How to run

```bash
npm run queries                      # all read queries with results
npm run queries -- --list            # list query ids
npm run queries -- news2-board       # one query
npm run queries -- --explain         # also show which index each query used
npm run queries -- --updates         # also run the C, U and D write demos (changes data; reseed afterwards)
npm run seed -- --reset              # restore the sample data
mongosh "mongodb://localhost:27017" queries/queries.mongosh.js   # same queries in mongosh
```

Needs MongoDB 6.0 or newer.

| id | type | query |
|---|---|---|
| `case-observations` | find | Observation history for case 8 |
| `red-flags` | find | Observations with a NEWS2 red flag |
| `open-incidents` | find | Incident work queue (open and under review) |
| `case-incidents` | find | All incidents linked to case 3 |
| `search-notes` | find | Full-text search of clinical notes: "oxygen breathless" |
| `draft-queue` | find | Draft notes waiting for sign-off |
| `news2-board` | aggregate | NEWS2 deterioration board as at 12:45 |
| `response-times` | aggregate | Ambulance response times (target 15 minutes call-to-scene) |
| `incident-trends` | aggregate | Incident trend dashboard |
| `hotspots` | aggregate | Incident hotspots around the hospital |
| `vitals-summary` | aggregate | Vital-sign summary per case |
| `case-timeline` | aggregate | Unified timeline for case 8 |
| `record-observation` | insert | Record a new set of vital signs for case 5 |
| `report-incident` | insert | File an in-hospital incident (patient fall, case 9) |
| `write-note` | insert | Write a draft progress note for case 9 |
| `start-review` | update | Start reviewing incident INC-2026-0007 |
| `close-incident` | update | Close incident INC-2026-0007 |
| `sign-note` | update | Sign the draft progress note for case 5 |
| `amend-note` | update | Amend the signed procedure note for case 4 |
| `edit-draft` | update | Edit the draft progress note for case 1 |
| `delete-draft` | delete | Discard the draft progress note for case 1 |
| `delete-observation` | delete | Remove an observation entered in error |
| `purge-incidents` | delete | Purge closed incidents last updated before 09:15 |

## NEWS2 early-warning score (used by F2 and A1)

NEWS2 is the National Early Warning Score 2 (Royal College of Physicians, 2017). Each of seven vital signs gets 0 to 3 points, and the points are added up. The bands live in one table in `lib/news2.js`. The MongoDB `$switch` expressions, the red-flag filter and the JavaScript scorer are all generated from it, so they cannot disagree.

| Parameter | Bands (value: points) |
|---|---|
| Respiration rate (/min) | ≤ 8: **3** · 9–11: **1** · 12–20: **0** · 21–24: **2** · ≥ 25: **3** |
| SpO2 Scale 1 (%) | ≤ 91: **3** · 92–93: **2** · 94–95: **1** · ≥ 96: **0** |
| Supplemental oxygen | yes: **2** · no: **0** |
| Systolic BP (mmHg) | ≤ 90: **3** · 91–100: **2** · 101–110: **1** · 111–219: **0** · ≥ 220: **3** |
| Pulse (/min) | ≤ 40: **3** · 41–50: **1** · 51–90: **0** · 91–110: **1** · 111–130: **2** · ≥ 131: **3** |
| Consciousness (ACVPU) | Alert: **0** · new Confusion, Voice, Pain, Unresponsive: **3** |
| Temperature (°C) | ≤ 35.0: **3** · 35.1–36.0: **1** · 36.1–38.0: **0** · 38.1–39.0: **1** · ≥ 39.1: **2** |

| Total | Risk | Response |
|---|---|---|
| 0–4 | low | routine ward monitoring |
| 0–4 with any single 3 | low-medium | urgent ward-based review (a single parameter scored 3) |
| 5–6 | medium | urgent review by a clinician, at least hourly observations |
| 7+ | high | emergency assessment, continuous monitoring |

This is a teaching implementation for a database project, not a clinical tool.

## Find queries (filtering and sorting)

### F1. Observation history for case 8

**Purpose.** Shows every vital-sign reading for one patient in time order, from the ambulance to the ward. This is the data behind the observation chart on the case screen.

**MongoDB features:** equality filter, sort, projection.

**Index used:** `uniq_case_observed_source`

Run it: `npm run queries -- case-observations`

<details><summary>Query</summary>

```js
db.observation_logs.find(
  { case_id: 8 },
  { _id: 0, schema_version: 0 }
).sort({ observed_at: 1 })
```

</details>

**Expected output.** 6 documents (first 2 shown):

```json
[
  {
    "case_id": 8,
    "observed_at": "2026-10-24T11:42:00+05:30",
    "source": "prehospital",
    "recorded_by": { "staff_id": 7 },
    "vitals": {
      "heart_rate": 124,
      "resp_rate": 30,
      "spo2": 89,
      "on_supplemental_o2": false,
      "bp": { "systolic": 132, "diastolic": 84 },
      "consciousness": "A"
    },
    "additional": { "peak_flow_l_min": 150, "wheeze": "widespread" }
  },
  {
    "case_id": 8,
    "observed_at": "2026-10-24T11:50:00+05:30",
    "source": "prehospital",
    "recorded_by": { "staff_id": 7 },
    "vitals": {
      "heart_rate": 120,
      "resp_rate": 28,
      "spo2": 92,
      "on_supplemental_o2": true,
      "bp": { "systolic": 130, "diastolic": 82 },
      "consciousness": "A"
    },
    "notes": "After oxygen and nebuliser"
  },
  "... 4 more"
]
```

### F2. Observations with a NEWS2 red flag

**Purpose.** Finds readings where any single vital sign is in the most dangerous NEWS2 band (score 3): for example SpO2 91% or less, breathing rate 25 or more, or new confusion. Nurses use this list to see who needs urgent review.

**MongoDB features:** `$or` of range conditions on nested fields, date range, sort.

**Index used:** `observed_at (date range), then filter`

Run it: `npm run queries -- red-flags`

<details><summary>Query</summary>

```js
db.observation_logs.find(
  {
    observed_at: {
      $gte: ISODate("2026-10-23T18:30:00.000Z"),
      $lt: ISODate("2026-10-24T18:30:00.000Z")
    },
    $or: [
      { "vitals.resp_rate": { $lte: 8 } },
      { "vitals.resp_rate": { $gt: 24 } },
      { "vitals.spo2": { $lte: 91 } },
      { "vitals.bp.systolic": { $lte: 90 } },
      { "vitals.bp.systolic": { $gt: 219 } },
      { "vitals.heart_rate": { $lte: 40 } },
      { "vitals.heart_rate": { $gt: 130 } },
      { "vitals.temp_c": { $lte: 35 } },
      { "vitals.consciousness": { $in: ["C", "V", "P", "U"] } }
    ]
  },
  { _id: 0, case_id: 1, observed_at: 1, source: 1, vitals: 1 }
).sort({ observed_at: -1 })
```

</details>

**Expected output.** 5 documents (first 2 shown):

```json
[
  {
    "case_id": 8,
    "observed_at": "2026-10-24T12:30:00+05:30",
    "source": "ward",
    "vitals": {
      "heart_rate": 128,
      "resp_rate": 32,
      "spo2": 89,
      "on_supplemental_o2": true,
      "bp": { "systolic": 124, "diastolic": 78 },
      "temp_c": 37.5,
      "consciousness": "A",
      "gcs": 15
    }
  },
  {
    "case_id": 8,
    "observed_at": "2026-10-24T11:50:00+05:30",
    "source": "prehospital",
    "vitals": {
      "heart_rate": 120,
      "resp_rate": 28,
      "spo2": 92,
      "on_supplemental_o2": true,
      "bp": { "systolic": 130, "diastolic": 82 },
      "consciousness": "A"
    }
  },
  "... 3 more"
]
```

The `$or` list is generated from the NEWS2 band table in `lib/news2.js`, so it always matches the scoring used in A1.

### F3. Incident work queue (open and under review)

**Purpose.** Lists incidents that still need action, newest first. Uses the status_occurred index.

**MongoDB features:** `$in`, sort.

**Index used:** `status_occurred`

Run it: `npm run queries -- open-incidents`

<details><summary>Query</summary>

```js
db.incident_reports.find(
  { status: { $in: ["open", "under_review"] } },
  {
    _id: 0,
    incident_no: 1,
    category: 1,
    incident_type: 1,
    severity: 1,
    status: 1,
    case_ids: 1,
    occurred_at: 1,
    summary: 1
  }
).sort({ occurred_at: -1 })
```

</details>

**Expected output.** 2 documents:

```json
[
  {
    "incident_no": "INC-2026-0005",
    "category": "prehospital",
    "incident_type": "medical_respiratory",
    "severity": "critical",
    "status": "under_review",
    "case_ids": [8],
    "occurred_at": "2026-10-24T11:20:00+05:30",
    "summary": "Acute breathlessness at home with audible wheeze, not relieved by own inhaler. Oxygen started by crew."
  },
  {
    "incident_no": "INC-2026-0007",
    "category": "in_hospital",
    "incident_type": "delay_in_care",
    "severity": "moderate",
    "status": "open",
    "case_ids": [3],
    "occurred_at": "2026-10-24T09:15:00+05:30",
    "summary": "CT head for a head-injury patient still not started 50 minutes after it was requested because of a scanner queue."
  }
]
```

### F4. All incidents linked to case 3

**Purpose.** One case can have both an ambulance incident and an in-hospital incident. Uses the multikey index on case_ids.

**MongoDB features:** query on an array field (multikey index).

**Index used:** `case_ids`

Run it: `npm run queries -- case-incidents`

<details><summary>Query</summary>

```js
db.incident_reports.find(
  { case_ids: 3 },
  { _id: 0, schema_version: 0 }
).sort({ occurred_at: 1 })
```

</details>

**Expected output.** 2 documents:

```json
[
  {
    "incident_no": "INC-2026-0002",
    "category": "prehospital",
    "incident_type": "trauma_fall",
    "severity": "high",
    "status": "closed"
  },
  {
    "incident_no": "INC-2026-0007",
    "category": "in_hospital",
    "incident_type": "delay_in_care",
    "severity": "moderate",
    "status": "open"
  }
]
```

Expected output shows only the main fields; the query returns full documents.

### F5. Full-text search of clinical notes: "oxygen breathless"

**Purpose.** Searches note titles, tags and text, ranked by relevance (title matches weigh most). Lets a clinician find e.g. every note mentioning oxygen without knowing the case number.

**MongoDB features:** `$text` search with stemming ("breathlessness" matches "breathless"), relevance score via `$meta: "textScore"`, field weights.

**Index used:** `notes_text`

Run it: `npm run queries -- search-notes`

<details><summary>Query</summary>

```js
db.clinical_notes.find(
  { $text: { $search: "oxygen breathless" } },
  {
    _id: 0,
    case_id: 1,
    note_type: 1,
    title: 1,
    created_at: 1,
    status: 1,
    score: { $meta: "textScore" }
  }
).sort({ score: { $meta: "textScore" }, created_at: -1 })
```

</details>

**Expected output.** Five notes, highest relevance first. The exact scores depend on MongoDB's text scoring, so only the set of titles is fixed:

- Assessment: acute breathlessness (case 8)
- Escalation: increased work of breathing (case 8)
- Triage: central chest pain (case 1)
- Cardiology assessment (case 1)
- Progress: pain settling (case 1)

### F6. Draft notes waiting for sign-off

**Purpose.** The sign-off queue, oldest first. Served by a partial index that only contains draft notes, so it stays small however many signed notes accumulate.

**MongoDB features:** partial index (only drafts are indexed).

**Index used:** `draft_queue`

Run it: `npm run queries -- draft-queue`

<details><summary>Query</summary>

```js
db.clinical_notes.find(
  { status: "draft" },
  { case_id: 1, author: 1, title: 1, created_at: 1 }
).sort({ created_at: 1 })
```

</details>

**Expected output.** 2 documents:

```json
[
  {
    "case_id": 1,
    "author": { "doctor_id": 2 },
    "title": "Progress: pain settling",
    "created_at": "2026-10-24T10:00:00+05:30"
  },
  {
    "case_id": 5,
    "author": { "doctor_id": 1 },
    "title": "Progress: awaiting ultrasound",
    "created_at": "2026-10-24T12:10:00+05:30"
  }
]
```

## Aggregation pipelines

### A1. NEWS2 deterioration board as at 12:45

**Purpose.** Calculates the NEWS2 early-warning score for every complete set of observations, compares each score with the same patient's previous one, and returns one row per patient: current score and risk, peak score, history, and whether the score rose by 2 or more between readings. Sorted so the sickest patients are at the top. The demo looks at the ward as it was at 12:45, when case 8 was at its worst; the API uses the current time.

**MongoDB features:** `$switch` scoring expressions, `$setWindowFields` + `$shift` (previous reading per patient), `$group` with `$last`, `$max`, `$push`, multi-key `$sort`.

**Index used:** `observed_at`

Run it: `npm run queries -- news2-board`

<details><summary>Query</summary>

```js
db.observation_logs.aggregate([
  {
    $match: {
      observed_at: {
        $gte: ISODate("2026-10-23T18:30:00.000Z"),
        $lt: ISODate("2026-10-24T07:15:00.000Z")
      }
    }
  },
  {
    $set: {
      news2: {
        components: {
          resp_rate: {
            $cond: [
              { $eq: [{ $type: "$vitals.resp_rate" }, "missing"] },
              null,
              {
                $switch: {
                  branches: [
                    { case: { $lte: ["$vitals.resp_rate", 8] }, then: 3 },
                    { case: { $lte: ["$vitals.resp_rate", 11] }, then: 1 },
                    { case: { $lte: ["$vitals.resp_rate", 20] }, then: 0 },
                    { case: { $lte: ["$vitals.resp_rate", 24] }, then: 2 }
                  ],
                  default: 3
                }
              }
            ]
          },
          spo2: {
            $cond: [
              { $eq: [{ $type: "$vitals.spo2" }, "missing"] },
              null,
              {
                $switch: {
                  branches: [
                    { case: { $lte: ["$vitals.spo2", 91] }, then: 3 },
                    { case: { $lte: ["$vitals.spo2", 93] }, then: 2 },
                    { case: { $lte: ["$vitals.spo2", 95] }, then: 1 }
                  ],
                  default: 0
                }
              }
            ]
          },
          on_supplemental_o2: {
            $cond: [
              { $eq: [{ $type: "$vitals.on_supplemental_o2" }, "missing"] },
              null,
              { $cond: [{ $eq: ["$vitals.on_supplemental_o2", true] }, 2, 0] }
            ]
          },
          systolic: {
            $cond: [
              { $eq: [{ $type: "$vitals.bp.systolic" }, "missing"] },
              null,
              {
                $switch: {
                  branches: [
                    { case: { $lte: ["$vitals.bp.systolic", 90] }, then: 3 },
                    { case: { $lte: ["$vitals.bp.systolic", 100] }, then: 2 },
                    { case: { $lte: ["$vitals.bp.systolic", 110] }, then: 1 },
                    { case: { $lte: ["$vitals.bp.systolic", 219] }, then: 0 }
                  ],
                  default: 3
                }
              }
            ]
          },
          heart_rate: {
            $cond: [
              { $eq: [{ $type: "$vitals.heart_rate" }, "missing"] },
              null,
              {
                $switch: {
                  branches: [
                    { case: { $lte: ["$vitals.heart_rate", 40] }, then: 3 },
                    { case: { $lte: ["$vitals.heart_rate", 50] }, then: 1 },
                    { case: { $lte: ["$vitals.heart_rate", 90] }, then: 0 },
                    { case: { $lte: ["$vitals.heart_rate", 110] }, then: 1 },
                    { case: { $lte: ["$vitals.heart_rate", 130] }, then: 2 }
                  ],
                  default: 3
                }
              }
            ]
          },
          consciousness: {
            $cond: [
              { $eq: [{ $type: "$vitals.consciousness" }, "missing"] },
              null,
              { $cond: [{ $eq: ["$vitals.consciousness", "A"] }, 0, 3] }
            ]
          },
          temp_c: {
            $cond: [
              { $eq: [{ $type: "$vitals.temp_c" }, "missing"] },
              null,
              {
                $switch: {
                  branches: [
                    { case: { $lte: ["$vitals.temp_c", 35] }, then: 3 },
                    { case: { $lte: ["$vitals.temp_c", 36] }, then: 1 },
                    { case: { $lte: ["$vitals.temp_c", 38] }, then: 0 },
                    { case: { $lte: ["$vitals.temp_c", 39] }, then: 1 }
                  ],
                  default: 2
                }
              }
            ]
          }
        }
      }
    }
  },
  {
    $set: {
      "news2.total": {
        $cond: [
          {
            $in: [
              null,
              [
                "$news2.components.resp_rate",
                "$news2.components.spo2",
                "$news2.components.on_supplemental_o2",
                "$news2.components.systolic",
                "$news2.components.heart_rate",
                "$news2.components.consciousness",
                "$news2.components.temp_c"
              ]
            ]
          },
          null,
          {
            $add: [
              "$news2.components.resp_rate",
              "$news2.components.spo2",
              "$news2.components.on_supplemental_o2",
              "$news2.components.systolic",
              "$news2.components.heart_rate",
              "$news2.components.consciousness",
              "$news2.components.temp_c"
            ]
          }
        ]
      },
      "news2.max_single": {
        $cond: [
          {
            $in: [
              null,
              [
                "$news2.components.resp_rate",
                "$news2.components.spo2",
                "$news2.components.on_supplemental_o2",
                "$news2.components.systolic",
                "$news2.components.heart_rate",
                "$news2.components.consciousness",
                "$news2.components.temp_c"
              ]
            ]
          },
          null,
          {
            $max: [
              "$news2.components.resp_rate",
              "$news2.components.spo2",
              "$news2.components.on_supplemental_o2",
              "$news2.components.systolic",
              "$news2.components.heart_rate",
              "$news2.components.consciousness",
              "$news2.components.temp_c"
            ]
          }
        ]
      }
    }
  },
  {
    $set: {
      "news2.risk": {
        $switch: {
          branches: [
            { case: { $eq: ["$news2.total", null] }, then: null },
            { case: { $gte: ["$news2.total", 7] }, then: "high" },
            { case: { $gte: ["$news2.total", 5] }, then: "medium" },
            { case: { $eq: ["$news2.max_single", 3] }, then: "low-medium" }
          ],
          default: "low"
        }
      }
    }
  },
  { $match: { "news2.total": { $ne: null } } },
  {
    $setWindowFields: {
      partitionBy: "$case_id",
      sortBy: { observed_at: 1 },
      output: { previous_total: { $shift: { output: "$news2.total", by: -1 } } }
    }
  },
  {
    $set: {
      "news2.change": {
        $cond: [
          { $eq: ["$previous_total", null] },
          null,
          { $subtract: ["$news2.total", "$previous_total"] }
        ]
      }
    }
  },
  { $sort: { case_id: 1, observed_at: 1 } },
  {
    $group: {
      _id: "$case_id",
      scored_observations: { $sum: 1 },
      peak_score: { $max: "$news2.total" },
      latest: {
        $last: {
          observed_at: "$observed_at",
          source: "$source",
          score: "$news2.total",
          risk: "$news2.risk",
          change: "$news2.change"
        }
      },
      history: {
        $push: { observed_at: "$observed_at", score: "$news2.total", change: "$news2.change" }
      },
      deterioration_detected: { $max: { $gte: [{ $ifNull: ["$news2.change", 0] }, 2] } }
    }
  },
  {
    $project: {
      _id: 0,
      case_id: "$_id",
      latest: 1,
      peak_score: 1,
      deterioration_detected: 1,
      scored_observations: 1,
      history: 1
    }
  },
  { $sort: { "latest.score": -1, peak_score: -1, case_id: 1 } }
])
```

</details>

**Expected output.** 9 documents (first 3 shown):

```json
[
  {
    "case_id": 8,
    "latest": {
      "observed_at": "2026-10-24T12:30:00+05:30",
      "source": "ward",
      "score": 10,
      "risk": "high",
      "change": 2
    },
    "peak_score": 10,
    "deterioration_detected": true,
    "scored_observations": 2,
    "history": [
      { "observed_at": "2026-10-24T12:02:00+05:30", "score": 8, "change": null },
      { "observed_at": "2026-10-24T12:30:00+05:30", "score": 10, "change": 2 }
    ]
  },
  {
    "case_id": 2,
    "latest": {
      "observed_at": "2026-10-24T11:00:00+05:30",
      "source": "ward",
      "score": 1,
      "risk": "low",
      "change": -2
    },
    "peak_score": 8,
    "deterioration_detected": false,
    "scored_observations": 3,
    "history": [
      { "observed_at": "2026-10-24T08:42:00+05:30", "score": 8, "change": null },
      { "observed_at": "2026-10-24T10:00:00+05:30", "score": 3, "change": -5 },
      { "observed_at": "2026-10-24T11:00:00+05:30", "score": 1, "change": -2 }
    ]
  },
  {
    "case_id": 5,
    "latest": {
      "observed_at": "2026-10-24T12:00:00+05:30",
      "source": "ward",
      "score": 1,
      "risk": "low",
      "change": -1
    },
    "peak_score": 5,
    "deterioration_detected": false,
    "scored_observations": 3,
    "history": [
      { "observed_at": "2026-10-24T10:12:00+05:30", "score": 5, "change": null },
      { "observed_at": "2026-10-24T11:00:00+05:30", "score": 2, "change": -3 },
      { "observed_at": "2026-10-24T12:00:00+05:30", "score": 1, "change": -1 }
    ]
  },
  "... 6 more"
]
```

Readings without all seven NEWS2 parameters (e.g. ambulance readings with no temperature) are not scored. Case 8 rose from 8 to 10 between triage and the 12:30 ward reading, so `deterioration_detected` is true. That matches the escalation note written at 12:32.

### A2. Ambulance response times (target 15 minutes call-to-scene)

**Purpose.** Measures each stage of every ambulance call (call to dispatch, call to scene, time at scene, transport, call to hospital) and flags calls that missed the 15-minute target. Returns per-incident rows and summary averages in one query.

**MongoDB features:** `$arrayToObject` + `$map` (timeline array to named timestamps), `$dateDiff`, `$facet` (rows + summary in one query), `$round`.

Run it: `npm run queries -- response-times`

<details><summary>Query</summary>

```js
db.incident_reports.aggregate([
  {
    $match: {
      category: "prehospital",
      occurred_at: {
        $gte: ISODate("2026-10-23T18:30:00.000Z"),
        $lt: ISODate("2026-10-24T18:30:00.000Z")
      }
    }
  },
  {
    $set: {
      t: {
        $arrayToObject: { $map: { input: "$timeline", as: "e", in: { k: "$$e.event", v: "$$e.at" } } }
      }
    }
  },
  {
    $set: {
      minutes: {
        call_to_dispatch: {
          $dateDiff: { startDate: "$t.call_received", endDate: "$t.dispatched", unit: "minute" }
        },
        call_to_scene: {
          $dateDiff: { startDate: "$t.call_received", endDate: "$t.on_scene", unit: "minute" }
        },
        at_scene: {
          $dateDiff: { startDate: "$t.on_scene", endDate: "$t.left_scene", unit: "minute" }
        },
        transport: {
          $dateDiff: { startDate: "$t.left_scene", endDate: "$t.arrived_hospital", unit: "minute" }
        },
        call_to_hospital: {
          $dateDiff: {
            startDate: "$t.call_received",
            endDate: "$t.arrived_hospital",
            unit: "minute"
          }
        }
      }
    }
  },
  { $set: { target_breached: { $gt: ["$minutes.call_to_scene", 15] } } },
  {
    $facet: {
      incidents: [
        { $sort: { "minutes.call_to_scene": -1, incident_no: 1 } },
        {
          $project: {
            _id: 0,
            incident_no: 1,
            case_ids: 1,
            incident_type: 1,
            severity: 1,
            minutes: 1,
            target_breached: 1
          }
        }
      ],
      summary: [
        {
          $group: {
            _id: null,
            incidents: { $sum: 1 },
            avg_call_to_scene: { $avg: "$minutes.call_to_scene" },
            max_call_to_scene: { $max: "$minutes.call_to_scene" },
            avg_at_scene: { $avg: "$minutes.at_scene" },
            avg_transport: { $avg: "$minutes.transport" },
            avg_call_to_hospital: { $avg: "$minutes.call_to_hospital" },
            target_breaches: { $sum: { $cond: ["$target_breached", 1, 0] } }
          }
        },
        {
          $project: {
            _id: 0,
            incidents: 1,
            max_call_to_scene: 1,
            target_breaches: 1,
            avg_call_to_scene: { $round: ["$avg_call_to_scene", 1] },
            avg_at_scene: { $round: ["$avg_at_scene", 1] },
            avg_transport: { $round: ["$avg_transport", 1] },
            avg_call_to_hospital: { $round: ["$avg_call_to_hospital", 1] }
          }
        }
      ],
      by_severity: [
        {
          $group: {
            _id: "$severity",
            incidents: { $sum: 1 },
            avg_call_to_scene: { $avg: "$minutes.call_to_scene" }
          }
        },
        {
          $project: {
            _id: 0,
            severity: "$_id",
            incidents: 1,
            avg_call_to_scene: { $round: ["$avg_call_to_scene", 1] }
          }
        },
        { $sort: { severity: 1 } }
      ]
    }
  },
  { $set: { summary: { $first: "$summary" }, target_minutes: 15 } }
])
```

</details>

**Expected output.** 1 document:

```json
[
  {
    "incidents": [
      {
        "incident_no": "INC-2026-0005",
        "case_ids": [8],
        "incident_type": "medical_respiratory",
        "severity": "critical",
        "minutes": {
          "call_to_dispatch": 2,
          "call_to_scene": 16,
          "at_scene": 8,
          "transport": 12,
          "call_to_hospital": 36
        },
        "target_breached": true
      },
      "... 4 more"
    ],
    "summary": {
      "incidents": 5,
      "avg_call_to_scene": 13.4,
      "max_call_to_scene": 16,
      "avg_at_scene": 7.4,
      "avg_transport": 9.6,
      "avg_call_to_hospital": 30.4,
      "target_breaches": 1
    },
    "by_severity": [
      { "severity": "critical", "incidents": 1, "avg_call_to_scene": 16 },
      { "severity": "high", "incidents": 2, "avg_call_to_scene": 11.5 },
      { "severity": "moderate", "incidents": 2, "avg_call_to_scene": 14 }
    ],
    "target_minutes": 15
  }
]
```

INC-2026-0005 took 16 minutes from call to scene, over the 15-minute target. That is why it is "under_review" in the incident data.

### A3. Incident trend dashboard

**Purpose.** Breaks incidents down by type, severity, status, hour of day (IST), day, and harm level for in-hospital incidents, and lists open items with how long they have been open. All panels come from a single $facet query.

**MongoDB features:** `$facet` with eight sub-pipelines, `$hour` and `$dateToString` with an IST time zone, `$count`, `$dateDiff` in hours.

Run it: `npm run queries -- incident-trends`

<details><summary>Query</summary>

```js
db.incident_reports.aggregate([
  {
    $match: {
      occurred_at: {
        $gte: ISODate("2026-10-23T18:30:00.000Z"),
        $lt: ISODate("2026-10-24T18:30:00.000Z")
      }
    }
  },
  {
    $facet: {
      total: [{ $count: "incidents" }],
      by_type: [
        {
          $group: {
            _id: { category: "$category", incident_type: "$incident_type" },
            incidents: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            category: "$_id.category",
            incident_type: "$_id.incident_type",
            incidents: 1
          }
        },
        { $sort: { incidents: -1, category: 1, incident_type: 1 } }
      ],
      by_severity: [
        { $group: { _id: "$severity", incidents: { $sum: 1 } } },
        { $project: { _id: 0, severity: "$_id", incidents: 1 } },
        { $sort: { severity: 1 } }
      ],
      by_status: [
        { $group: { _id: "$status", incidents: { $sum: 1 } } },
        { $project: { _id: 0, status: "$_id", incidents: 1 } },
        { $sort: { status: 1 } }
      ],
      by_hour: [
        {
          $group: {
            _id: { $hour: { date: "$occurred_at", timezone: "Asia/Kolkata" } },
            incidents: { $sum: 1 }
          }
        },
        { $project: { _id: 0, hour: "$_id", incidents: 1 } },
        { $sort: { hour: 1 } }
      ],
      by_day: [
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$occurred_at", timezone: "Asia/Kolkata" }
            },
            incidents: { $sum: 1 }
          }
        },
        { $project: { _id: 0, day: "$_id", incidents: 1 } },
        { $sort: { day: 1 } }
      ],
      in_hospital_harm: [
        { $match: { category: "in_hospital" } },
        { $group: { _id: "$harm_level", incidents: { $sum: 1 } } },
        { $project: { _id: 0, harm_level: "$_id", incidents: 1 } },
        { $sort: { harm_level: 1 } }
      ],
      open_items: [
        { $match: { status: { $ne: "closed" } } },
        {
          $project: {
            _id: 0,
            incident_no: 1,
            incident_type: 1,
            severity: 1,
            status: 1,
            hours_open: {
              $dateDiff: {
                startDate: "$reported_at",
                endDate: ISODate("2026-10-24T12:30:00.000Z"),
                unit: "hour"
              }
            }
          }
        },
        { $sort: { hours_open: -1, incident_no: 1 } }
      ]
    }
  },
  { $set: { total: { $ifNull: [{ $first: "$total.incidents" }, 0] } } }
])
```

</details>

**Expected output.** 1 document:

```json
[
  {
    "total": 8,
    "by_type": [
      { "category": "in_hospital", "incident_type": "delay_in_care", "incidents": 1 },
      { "category": "in_hospital", "incident_type": "equipment_device", "incidents": 1 },
      { "category": "in_hospital", "incident_type": "patient_fall", "incidents": 1 },
      {
        "category": "prehospital",
        "incident_type": "medical_abdominal",
        "incidents": 1
      },
      { "category": "prehospital", "incident_type": "medical_cardiac", "incidents": 1 },
      {
        "category": "prehospital",
        "incident_type": "medical_respiratory",
        "incidents": 1
      },
      { "category": "prehospital", "incident_type": "road_traffic", "incidents": 1 },
      { "category": "prehospital", "incident_type": "trauma_fall", "incidents": 1 }
    ],
    "by_severity": [
      { "severity": "critical", "incidents": 1 },
      { "severity": "high", "incidents": 2 },
      { "severity": "low", "incidents": 2 },
      { "severity": "moderate", "incidents": 3 }
    ],
    "by_status": [
      { "status": "closed", "incidents": 6 },
      { "status": "open", "incidents": 1 },
      { "status": "under_review", "incidents": 1 }
    ],
    "by_hour": [
      { "hour": 7, "incidents": 1 },
      { "hour": 8, "incidents": 2 },
      { "hour": 9, "incidents": 3 },
      { "hour": 11, "incidents": 2 }
    ],
    "by_day": [{ "day": "2026-10-24", "incidents": 8 }],
    "in_hospital_harm": [{ "harm_level": "none", "incidents": 3 }],
    "open_items": [
      {
        "incident_no": "INC-2026-0007",
        "incident_type": "delay_in_care",
        "severity": "moderate",
        "status": "open",
        "hours_open": 8
      },
      {
        "incident_no": "INC-2026-0005",
        "incident_type": "medical_respiratory",
        "severity": "critical",
        "status": "under_review",
        "hours_open": 7
      }
    ]
  }
]
```

`hours_open` is measured to the fixed demo time 18:00 IST; the API passes the current time.

### A4. Incident hotspots around the hospital

**Purpose.** Orders ambulance incidents by distance from the hospital and groups them into distance bands. Helps plan where to station ambulances.

**MongoDB features:** `$geoNear` (must be the first stage), GeoJSON points, `$bucket` distance bands, `$facet`.

**Index used:** `location_geo_2dsphere`

Run it: `npm run queries -- hotspots`

<details><summary>Query</summary>

```js
db.incident_reports.aggregate([
  {
    $geoNear: {
      near: { type: "Point", coordinates: [77.6033, 12.9857] },
      key: "location.geo",
      distanceField: "distance_m",
      maxDistance: 30000,
      spherical: true,
      query: { category: "prehospital" }
    }
  },
  { $set: { distance_km: { $round: [{ $divide: ["$distance_m", 1000] }, 1] } } },
  {
    $facet: {
      nearest: [
        {
          $project: {
            _id: 0,
            incident_no: 1,
            incident_type: 1,
            severity: 1,
            distance_km: 1,
            place: "$location.description",
            coordinates: "$location.geo.coordinates"
          }
        }
      ],
      by_distance_band: [
        {
          $bucket: {
            groupBy: "$distance_km",
            boundaries: [0, 5, 10, 20],
            default: "20+",
            output: { incidents: { $sum: 1 }, incident_nos: { $push: "$incident_no" } }
          }
        },
        {
          $project: {
            _id: 0,
            band_km: {
              $switch: {
                branches: [
                  { case: { $eq: ["$_id", 0] }, then: "0-5" },
                  { case: { $eq: ["$_id", 5] }, then: "5-10" },
                  { case: { $eq: ["$_id", 10] }, then: "10-20" }
                ],
                default: "20+"
              }
            },
            incidents: 1,
            incident_nos: 1
          }
        }
      ]
    }
  }
])
```

</details>

**Expected output.** 1 document:

```json
[
  {
    "nearest": [
      {
        "incident_no": "INC-2026-0001",
        "incident_type": "medical_cardiac",
        "severity": "high",
        "distance_km": 4.3,
        "place": "Fitness centre, 100 Feet Road, Indiranagar",
        "coordinates": [77.6408, 12.9719]
      },
      {
        "incident_no": "INC-2026-0004",
        "incident_type": "medical_abdominal",
        "severity": "moderate",
        "distance_km": 5.9,
        "place": "Office complex, Koramangala 5th Block",
        "coordinates": [77.619, 12.9345]
      },
      {
        "incident_no": "INC-2026-0002",
        "incident_type": "trauma_fall",
        "severity": "high",
        "distance_km": 7.1,
        "place": "Residential building, 4th Block, Jayanagar",
        "coordinates": [77.5838, 12.925]
      },
      {
        "incident_no": "INC-2026-0003",
        "incident_type": "road_traffic",
        "severity": "moderate",
        "distance_km": 8.3,
        "place": "Tumakuru Road, near Yeshwanthpur flyover",
        "coordinates": [77.541, 13.0285]
      },
      {
        "incident_no": "INC-2026-0005",
        "incident_type": "medical_respiratory",
        "severity": "critical",
        "distance_km": 16.8,
        "place": "Apartment complex, Electronic City Phase 1",
        "coordinates": [77.66, 12.8452]
      }
    ],
    "by_distance_band": [
      { "band_km": "0-5", "incidents": 1, "incident_nos": ["INC-2026-0001"] },
      {
        "band_km": "5-10",
        "incidents": 3,
        "incident_nos": ["INC-2026-0004", "INC-2026-0002", "INC-2026-0003"]
      },
      { "band_km": "10-20", "incidents": 1, "incident_nos": ["INC-2026-0005"] }
    ]
  }
]
```

Distances are measured from the (fictional) hospital location [77.6033,12.9857] [longitude, latitude] and rounded to 0.1 km. In-hospital incidents have no coordinates and are not included.

### A5. Vital-sign summary per case

**Purpose.** Ranges, averages and pain trend for each patient's stay, for handover and discharge summaries.

**MongoDB features:** `$group` with `$min`, `$max`, `$avg`, `$first`, `$last`, `$addToSet`, `$sortArray`, `$dateDiff`.

Run it: `npm run queries -- vitals-summary`

<details><summary>Query</summary>

```js
db.observation_logs.aggregate([
  { $match: {} },
  { $sort: { case_id: 1, observed_at: 1 } },
  {
    $group: {
      _id: "$case_id",
      observations: { $sum: 1 },
      sources: { $addToSet: "$source" },
      first_at: { $first: "$observed_at" },
      last_at: { $last: "$observed_at" },
      hr_min: { $min: "$vitals.heart_rate" },
      hr_max: { $max: "$vitals.heart_rate" },
      hr_avg: { $avg: "$vitals.heart_rate" },
      spo2_min: { $min: "$vitals.spo2" },
      rr_max: { $max: "$vitals.resp_rate" },
      sbp_min: { $min: "$vitals.bp.systolic" },
      temp_max: { $max: "$vitals.temp_c" },
      pain_first: { $first: "$vitals.pain_score" },
      pain_last: { $last: "$vitals.pain_score" },
      oxygen_readings: { $sum: { $cond: ["$vitals.on_supplemental_o2", 1, 0] } }
    }
  },
  {
    $project: {
      _id: 0,
      case_id: "$_id",
      observations: 1,
      sources: { $sortArray: { input: "$sources", sortBy: 1 } },
      first_at: 1,
      last_at: 1,
      monitored_minutes: { $dateDiff: { startDate: "$first_at", endDate: "$last_at", unit: "minute" } },
      heart_rate: { min: "$hr_min", max: "$hr_max", avg: { $round: ["$hr_avg", 1] } },
      lowest_spo2: "$spo2_min",
      highest_resp_rate: "$rr_max",
      lowest_systolic: "$sbp_min",
      highest_temp_c: "$temp_max",
      pain: { first: "$pain_first", last: "$pain_last" },
      oxygen_readings: 1
    }
  },
  { $sort: { case_id: 1 } }
])
```

</details>

**Expected output.** 10 documents (first 2 shown):

```json
[
  {
    "case_id": 1,
    "observations": 4,
    "sources": ["prehospital", "triage", "ward"],
    "first_at": "2026-10-24T08:00:00+05:30",
    "last_at": "2026-10-24T09:45:00+05:30",
    "monitored_minutes": 105,
    "heart_rate": { "min": 88, "max": 118, "avg": 104 },
    "lowest_spo2": 93,
    "highest_resp_rate": 24,
    "lowest_systolic": 130,
    "highest_temp_c": 36.9,
    "pain": { "first": 8, "last": 2 },
    "oxygen_readings": 2
  },
  {
    "case_id": 2,
    "observations": 3,
    "sources": ["triage", "ward"],
    "first_at": "2026-10-24T08:42:00+05:30",
    "last_at": "2026-10-24T11:00:00+05:30",
    "monitored_minutes": 138,
    "heart_rate": { "min": 92, "max": 112, "avg": 101.3 },
    "lowest_spo2": 96,
    "highest_resp_rate": 22,
    "lowest_systolic": 98,
    "highest_temp_c": 39.2,
    "pain": { "first": 3, "last": 1 },
    "oxygen_readings": 0
  },
  "... 8 more"
]
```

### A6. Unified timeline for case 8

**Purpose.** Merges observations, clinical notes and incident reports for one case into a single chronological list, so a doctor taking over can read the whole story in order.

**MongoDB features:** `$unionWith` (three collections in one result), `$concat` + `$toString` to build readable summaries, `$literal`.

Run it: `npm run queries -- case-timeline`

<details><summary>Query</summary>

```js
db.observation_logs.aggregate([
  { $match: { case_id: 8 } },
  {
    $project: {
      _id: 0,
      at: "$observed_at",
      kind: { $literal: "observation" },
      detail: "$source",
      summary: {
        $concat: [
          "HR ",
          { $ifNull: [{ $toString: "$vitals.heart_rate" }, "?"] },
          ", RR ",
          { $ifNull: [{ $toString: "$vitals.resp_rate" }, "?"] },
          ", SpO2 ",
          { $ifNull: [{ $toString: "$vitals.spo2" }, "?"] },
          "%",
          { $cond: ["$vitals.on_supplemental_o2", " on O2", ""] },
          ", BP ",
          { $ifNull: [{ $toString: "$vitals.bp.systolic" }, "?"] },
          "/",
          { $ifNull: [{ $toString: "$vitals.bp.diastolic" }, "?"] }
        ]
      }
    }
  },
  {
    $unionWith: {
      coll: "clinical_notes",
      pipeline: [
        { $match: { case_id: 8 } },
        {
          $project: {
            _id: 0,
            at: "$created_at",
            kind: { $literal: "note" },
            detail: "$note_type",
            summary: "$title"
          }
        }
      ]
    }
  },
  {
    $unionWith: {
      coll: "incident_reports",
      pipeline: [
        { $match: { case_ids: 8 } },
        {
          $project: {
            _id: 0,
            at: "$occurred_at",
            kind: { $literal: "incident" },
            detail: "$incident_type",
            summary: { $concat: ["$incident_no", " (", "$severity", "): ", "$summary"] }
          }
        }
      ]
    }
  },
  { $sort: { at: 1, kind: 1 } }
])
```

</details>

**Expected output.** 9 documents:

```json
[
  {
    "at": "2026-10-24T11:20:00+05:30",
    "kind": "incident",
    "detail": "medical_respiratory",
    "summary": "INC-2026-0005 (critical): Acute breathlessness at home with audible wheeze, not relieved by own inhaler. Oxygen started by crew."
  },
  {
    "at": "2026-10-24T11:42:00+05:30",
    "kind": "observation",
    "detail": "prehospital",
    "summary": "HR 124, RR 30, SpO2 89%, BP 132/84"
  },
  {
    "at": "2026-10-24T11:50:00+05:30",
    "kind": "observation",
    "detail": "prehospital",
    "summary": "HR 120, RR 28, SpO2 92% on O2, BP 130/82"
  },
  {
    "at": "2026-10-24T12:02:00+05:30",
    "kind": "observation",
    "detail": "triage",
    "summary": "HR 118, RR 24, SpO2 93% on O2, BP 128/80"
  },
  {
    "at": "2026-10-24T12:15:00+05:30",
    "kind": "note",
    "detail": "assessment",
    "summary": "Assessment: acute breathlessness"
  },
  {
    "at": "2026-10-24T12:30:00+05:30",
    "kind": "observation",
    "detail": "ward",
    "summary": "HR 128, RR 32, SpO2 89% on O2, BP 124/78"
  },
  {
    "at": "2026-10-24T12:32:00+05:30",
    "kind": "note",
    "detail": "progress",
    "summary": "Escalation: increased work of breathing"
  },
  {
    "at": "2026-10-24T13:00:00+05:30",
    "kind": "observation",
    "detail": "ward",
    "summary": "HR 110, RR 24, SpO2 94% on O2, BP 126/80"
  },
  {
    "at": "2026-10-24T14:00:00+05:30",
    "kind": "observation",
    "detail": "ward",
    "summary": "HR 98, RR 20, SpO2 96% on O2, BP 124/78"
  }
]
```

## Writes: insert, update, delete

These change data. Run them with `--updates` and restore the sample data afterwards with `npm run seed -- --reset`.
They run in the order listed; D2 removes the reading C1 adds, and U4 moves INC-2026-0007 to review before U1 closes it.

Clinical records are kept, not deleted, so deletes are limited to unsigned drafts (D1), readings entered in error (D2) and expired closed incidents (D3). Signed notes can only be amended (U3).

### Inserts

#### C1. Record a new set of vital signs for case 5

**Purpose.** A nurse enters a ward observation. The builder fills in schema_version and checks the time is not in the future; the server-side validator checks every value is in range, and the unique index blocks a double submit of the same reading.

**MongoDB features:** `insertOne` checked by the `$jsonSchema` validator, unique index `uniq_case_observed_source` blocks duplicates.

Run it: `npm run queries -- record-observation --updates`

<details><summary>Query</summary>

```js
db.observation_logs.insertOne({
  schema_version: NumberInt(1),
  case_id: NumberInt(5),
  observed_at: ISODate("2026-10-24T09:30:00.000Z"),
  source: "ward",
  recorded_by: { staff_id: NumberInt(6) },
  vitals: {
    heart_rate: NumberInt(92),
    resp_rate: NumberInt(18),
    spo2: NumberInt(97),
    on_supplemental_o2: false,
    bp: { systolic: NumberInt(118), diastolic: NumberInt(76) },
    temp_c: 37.6,
    consciousness: "A",
    pain_score: NumberInt(4)
  },
  notes: "Pain improving after analgesia"
})
```

</details>

**Expected output.** `{ acknowledged: true, insertedId: ObjectId(...) }`. Case 5 now has a 15:00 ward reading. Running it a second time fails with duplicate-key error 11000; changing `spo2` to 120 fails with validation error 121.

#### C2. File an in-hospital incident (patient fall, case 9)

**Purpose.** Files a new safety incident. New reports always start as "open". In the API the number comes from an atomic counter (repository.nextIncidentNo); the demo uses the next free number.

**MongoDB features:** `insertOne`, category-specific `oneOf` rule (in-hospital incidents need `harm_level`).

Run it: `npm run queries -- report-incident --updates`

<details><summary>Query</summary>

```js
db.incident_reports.insertOne({
  schema_version: NumberInt(1),
  incident_no: "INC-2026-0009",
  category: "in_hospital",
  incident_type: "patient_fall",
  case_ids: [NumberInt(9)],
  occurred_at: ISODate("2026-10-24T09:40:00.000Z"),
  reported_at: ISODate("2026-10-24T09:50:00.000Z"),
  reported_by: { staff_id: NumberInt(5) },
  location: { description: "Orthopedics ward, bay 2" },
  severity: "low",
  harm_level: "none",
  summary: "Patient slipped while walking to the bathroom; no injury found on review.",
  timeline: [
    { event: "detected", at: ISODate("2026-10-24T09:40:00.000Z") },
    { event: "reported", at: ISODate("2026-10-24T09:50:00.000Z") }
  ],
  status: "open",
  created_at: ISODate("2026-10-24T09:50:00.000Z"),
  updated_at: ISODate("2026-10-24T09:50:00.000Z")
})
```

</details>

**Expected output.** `{ acknowledged: true, insertedId: ObjectId(...) }`. INC-2026-0009 is stored with `status: "open"`, `created_at` and `updated_at` set. The unique index `uniq_incident_no` rejects a second report with the same number.

#### C3. Write a draft progress note for case 9

**Purpose.** Creates a clinical note as a draft. It becomes part of the record only when signed (U2); until then the author can edit (U5) or discard it (D1).

**MongoDB features:** `insertOne`, notes always start as `status: "draft"`, link to an incident report via `links.incident_no`.

Run it: `npm run queries -- write-note --updates`

<details><summary>Query</summary>

```js
db.clinical_notes.insertOne({
  schema_version: NumberInt(1),
  case_id: NumberInt(9),
  note_type: "progress",
  author: { doctor_id: NumberInt(4) },
  created_at: ISODate("2026-10-24T10:10:00.000Z"),
  updated_at: ISODate("2026-10-24T10:10:00.000Z"),
  title: "Progress: fall on ward, no injury",
  body: "Reviewed after a fall on the ward. No head strike, no new pain, dressing intact. Falls risk assessment updated.",
  tags: ["fall", "review"],
  links: { incident_no: "INC-2026-0009" },
  status: "draft"
})
```

</details>

**Expected output.** `{ acknowledged: true, insertedId: ObjectId(...) }`. The note is stored as a draft and appears in the F6 sign-off queue and in F5 text search (e.g. searching "fall").

### Updates

#### U4. Start reviewing incident INC-2026-0007

**Purpose.** Moves an open incident to "under_review" and adds a "reviewed" event to its timeline. Only open incidents match, so the status can only move forward.

**MongoDB features:** `$set` + `$push` in one update, status can only move forward (filter matches `open` only).

Run it: `npm run queries -- start-review --updates`

<details><summary>Query</summary>

```js
db.incident_reports.updateOne(
  { incident_no: "INC-2026-0007", status: "open" },
  {
    $set: { status: "under_review", updated_at: ISODate("2026-10-24T08:30:00.000Z") },
    $push: {
      timeline: {
        event: "reviewed",
        at: ISODate("2026-10-24T08:30:00.000Z"),
        note: "Radiology and ED leads asked for a timeline of the CT request"
      }
    }
  }
)
```

</details>

**Expected output.** First run: `{ matchedCount: 1, modifiedCount: 1 }`. INC-2026-0007 becomes `status: "under_review"` with a `{ event: "reviewed" }` timeline entry. A second run matches nothing. U1 can then close it.

#### U1. Close incident INC-2026-0007

**Purpose.** Closes the CT-delay incident: sets the status, records who reviewed it and what was done, and adds a "closed" event to its timeline in a single update. Already-closed incidents are not matched, so the update cannot run twice.

**MongoDB features:** `$set` on nested fields, `$push` with `$each`, filter that only matches open incidents.

Run it: `npm run queries -- close-incident --updates`

<details><summary>Query</summary>

```js
db.incident_reports.updateOne(
  { incident_no: "INC-2026-0007", status: { $ne: "closed" } },
  {
    $set: {
      status: "closed",
      updated_at: ISODate("2026-10-24T10:30:00.000Z"),
      "follow_up.reviewed_by": { doctor_id: NumberInt(3) },
      "follow_up.closed_at": ISODate("2026-10-24T10:30:00.000Z")
    },
    $push: {
      timeline: { event: "closed", at: ISODate("2026-10-24T10:30:00.000Z") },
      "follow_up.actions": { $each: ["Added a priority slot for head-injury CT requests"] }
    }
  }
)
```

</details>

**Expected output.** First run: `{ matchedCount: 1, modifiedCount: 1 }`. INC-2026-0007 becomes `status: "closed"`, with `follow_up.reviewed_by: { doctor_id: 3 }`, the action listed, and a final `{ event: "closed" }` timeline entry. Running it again matches nothing (`matchedCount: 0`).

#### U2. Sign the draft progress note for case 5

**Purpose.** Moves a draft note to signed and records the time. Only drafts match the filter, so signing twice changes nothing.

**MongoDB features:** conditional update (only drafts match).

Run it: `npm run queries -- sign-note --updates`

<details><summary>Query</summary>

```js
db.clinical_notes.updateOne(
  { _id: draftNoteId, status: "draft" },
  {
    $set: {
      status: "signed",
      signed_at: ISODate("2026-10-24T06:50:00.000Z"),
      updated_at: ISODate("2026-10-24T06:50:00.000Z")
    }
  }
)
```

</details>

**Expected output.** First run: `{ matchedCount: 1, modifiedCount: 1 }`. The case 5 progress note gets `status: "signed"` and `signed_at`. A second run matches nothing.

#### U3. Amend the signed procedure note for case 4

**Purpose.** Corrects a signed note without losing the original: a pipeline update copies the current text into the amendments history and replaces it, in one atomic step.

**MongoDB features:** update with an aggregation pipeline (atomic read-modify-write), `$concatArrays`, `$literal` for user-supplied text.

Run it: `npm run queries -- amend-note --updates`

<details><summary>Query</summary>

```js
db.clinical_notes.updateOne(
  { _id: procedureNoteId, status: { $in: ["signed", "amended"] } },
  [
    {
      $set: {
        amendments: {
          $concatArrays: [
            { $ifNull: ["$amendments", []] },
            [
              {
                amended_at: ISODate("2026-10-24T07:30:00.000Z"),
                amended_by: { $literal: { doctor_id: NumberInt(4) } },
                reason: { $literal: "Added follow-up interval" },
                previous_body: "$body"
              }
            ]
          ]
        },
        body: {
          $literal: "X-ray confirms distal radius fracture. Left wrist immobilised in a below-elbow backslab. Distal pulses present and sensation intact after application. Fracture clinic follow-up in 7 days."
        },
        status: "amended",
        updated_at: ISODate("2026-10-24T07:30:00.000Z")
      }
    }
  ]
)
```

</details>

**Expected output.** `{ matchedCount: 1, modifiedCount: 1 }`. The note gets `status: "amended"`, the new text in `body`, and one `amendments` entry whose `previous_body` holds the original text ("...Fracture clinic follow-up arranged.").

#### U5. Edit the draft progress note for case 1

**Purpose.** The author changes the text of a note they have not signed yet. The filter requires status "draft" and the same author, so nobody can silently rewrite a signed note or someone else's draft.

**MongoDB features:** filter on `status` and `author` (only your own drafts).

Run it: `npm run queries -- edit-draft --updates`

<details><summary>Query</summary>

```js
db.clinical_notes.updateOne(
  { _id: case1DraftId, status: "draft", author: { doctor_id: NumberInt(2) } },
  {
    $set: {
      body: "Chest pain settling after treatment. Repeat troponin pending. Continue monitoring.",
      updated_at: ISODate("2026-10-24T05:00:00.000Z")
    }
  }
)
```

</details>

**Expected output.** `{ matchedCount: 1, modifiedCount: 1 }`. The case 1 draft gets the new body and `updated_at`. With `author: { doctor_id: 1 }` (someone else) it matches nothing.

### Deletes

#### D1. Discard the draft progress note for case 1

**Purpose.** Deletes a draft note. Only drafts written by the same author match: signed and amended notes are part of the medical record and can never be deleted, only amended.

**MongoDB features:** `deleteOne` with a filter on `status` and `author`.

Run it: `npm run queries -- delete-draft --updates`

<details><summary>Query</summary>

```js
db.clinical_notes.deleteOne({ _id: case1DraftId, status: "draft", author: { doctor_id: NumberInt(2) } })
```

</details>

**Expected output.** `{ deletedCount: 1 }`. Case 1 goes from 3 notes to 2. The same filter against a signed note deletes nothing (`deletedCount: 0`).

#### D2. Remove an observation entered in error

**Purpose.** Removes the reading added by C1, identified by its natural key (case, time, source), and only if the same person recorded it. Run C1 first.

**MongoDB features:** `deleteOne` by natural key (the unique index), only the person who recorded it.

Run it: `npm run queries -- delete-observation --updates`

<details><summary>Query</summary>

```js
db.observation_logs.deleteOne({
  case_id: NumberInt(5),
  observed_at: ISODate("2026-10-24T09:30:00.000Z"),
  source: "ward",
  recorded_by: { staff_id: NumberInt(6) }
})
```

</details>

**Expected output.** After C1: `{ deletedCount: 1 }` and case 5 is back to its original 4 observations. Without C1 first: `{ deletedCount: 0 }`.

#### D3. Purge closed incidents last updated before 09:15

**Purpose.** Housekeeping with deleteMany: removes closed incident reports older than a retention date. Open and under-review incidents never match.

**MongoDB features:** `deleteMany` with a range filter, open and under-review incidents never match.

Run it: `npm run queries -- purge-incidents --updates`

<details><summary>Query</summary>

```js
db.incident_reports.deleteMany({ status: "closed", updated_at: { $lt: ISODate("2026-10-24T03:45:00.000Z") } })
```

</details>

**Expected output.** `{ deletedCount: 2 }` (INC-2026-0001 and INC-2026-0002, both closed and last updated before 09:15). The collection goes from 8 incidents to 6 (9 to 7 if C2 ran first).
