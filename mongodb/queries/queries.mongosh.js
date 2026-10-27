// GENERATED FILE - do not edit by hand. Regenerate with: npm run export:mongosh
// Source: lib/queries.js and lib/demos.js (the same code the API uses).
//
// Hospital Emergency Management System - MongoDB demo queries for mongosh.
// Run all read queries:
//   mongosh "mongodb://localhost:27017" queries/queries.mongosh.js
// Dates are stored in UTC; 2026-10-24T02:30:00Z is 08:00 IST.

db = db.getSiblingDB("hospital_emergency_management");

// Inserts, updates and deletes change the sample data. Set to true to run them, then restore
// the data afterwards with: npm run seed -- --reset
const RUN_UPDATES = false;

// --------------------------------------------------------------------------
// F1. Observation history for case 8
// Shows every vital-sign reading for one patient in time order, from the
// ambulance to the ward. This is the data behind the observation chart on the
// case screen.
print("\nF1. Observation history for case 8");
printjson(
  db.observation_logs
    .find({ case_id: 8 }, { _id: 0, schema_version: 0 })
    .sort({ observed_at: 1 })
    .toArray()
);

// --------------------------------------------------------------------------
// F2. Observations with a NEWS2 red flag
// Finds readings where any single vital sign is in the most dangerous NEWS2
// band (score 3): for example SpO2 91% or less, breathing rate 25 or more, or
// new confusion. Nurses use this list to see who needs urgent review.
print("\nF2. Observations with a NEWS2 red flag");
printjson(
  db.observation_logs
    .find({
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
    }, { _id: 0, case_id: 1, observed_at: 1, source: 1, vitals: 1 })
    .sort({ observed_at: -1 })
    .toArray()
);

// --------------------------------------------------------------------------
// F3. Incident work queue (open and under review)
// Lists incidents that still need action, newest first. Uses the
// status_occurred index.
print("\nF3. Incident work queue (open and under review)");
printjson(
  db.incident_reports
    .find({ status: { $in: ["open", "under_review"] } }, {
      _id: 0,
      incident_no: 1,
      category: 1,
      incident_type: 1,
      severity: 1,
      status: 1,
      case_ids: 1,
      occurred_at: 1,
      summary: 1
    })
    .sort({ occurred_at: -1 })
    .toArray()
);

// --------------------------------------------------------------------------
// F4. All incidents linked to case 3
// One case can have both an ambulance incident and an in-hospital incident.
// Uses the multikey index on case_ids.
print("\nF4. All incidents linked to case 3");
printjson(
  db.incident_reports
    .find({ case_ids: 3 }, { _id: 0, schema_version: 0 })
    .sort({ occurred_at: 1 })
    .toArray()
);

// --------------------------------------------------------------------------
// F5. Full-text search of clinical notes: "oxygen breathless"
// Searches note titles, tags and text, ranked by relevance (title matches
// weigh most). Lets a clinician find e.g. every note mentioning oxygen
// without knowing the case number.
print("\nF5. Full-text search of clinical notes: \"oxygen breathless\"");
printjson(
  db.clinical_notes
    .find({ $text: { $search: "oxygen breathless" } }, {
      _id: 0,
      case_id: 1,
      note_type: 1,
      title: 1,
      created_at: 1,
      status: 1,
      score: { $meta: "textScore" }
    })
    .sort({ score: { $meta: "textScore" }, created_at: -1 })
    .toArray()
);

// --------------------------------------------------------------------------
// F6. Draft notes waiting for sign-off
// The sign-off queue, oldest first. Served by a partial index that only
// contains draft notes, so it stays small however many signed notes
// accumulate.
print("\nF6. Draft notes waiting for sign-off");
printjson(
  db.clinical_notes
    .find({ status: "draft" }, { case_id: 1, author: 1, title: 1, created_at: 1 })
    .sort({ created_at: 1 })
    .toArray()
);

// --------------------------------------------------------------------------
// A1. NEWS2 deterioration board as at 12:45
// Calculates the NEWS2 early-warning score for every complete set of
// observations, compares each score with the same patient's previous one, and
// returns one row per patient: current score and risk, peak score, history,
// and whether the score rose by 2 or more between readings. Sorted so the
// sickest patients are at the top. The demo looks at the ward as it was at
// 12:45, when case 8 was at its worst; the API uses the current time.
print("\nA1. NEWS2 deterioration board as at 12:45");
printjson(db.observation_logs.aggregate([
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
]).toArray());

// --------------------------------------------------------------------------
// A2. Ambulance response times (target 15 minutes call-to-scene)
// Measures each stage of every ambulance call (call to dispatch, call to
// scene, time at scene, transport, call to hospital) and flags calls that
// missed the 15-minute target. Returns per-incident rows and summary averages
// in one query.
print("\nA2. Ambulance response times (target 15 minutes call-to-scene)");
printjson(db.incident_reports.aggregate([
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
]).toArray());

// --------------------------------------------------------------------------
// A3. Incident trend dashboard
// Breaks incidents down by type, severity, status, hour of day (IST), day,
// and harm level for in-hospital incidents, and lists open items with how
// long they have been open. All panels come from a single $facet query.
print("\nA3. Incident trend dashboard");
printjson(db.incident_reports.aggregate([
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
]).toArray());

// --------------------------------------------------------------------------
// A4. Incident hotspots around the hospital
// Orders ambulance incidents by distance from the hospital and groups them
// into distance bands. Helps plan where to station ambulances.
print("\nA4. Incident hotspots around the hospital");
printjson(db.incident_reports.aggregate([
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
]).toArray());

// --------------------------------------------------------------------------
// A5. Vital-sign summary per case
// Ranges, averages and pain trend for each patient's stay, for handover and
// discharge summaries.
print("\nA5. Vital-sign summary per case");
printjson(db.observation_logs.aggregate([
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
]).toArray());

// --------------------------------------------------------------------------
// A6. Unified timeline for case 8
// Merges observations, clinical notes and incident reports for one case into
// a single chronological list, so a doctor taking over can read the whole
// story in order.
print("\nA6. Unified timeline for case 8");
printjson(db.observation_logs.aggregate([
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
]).toArray());

// ==========================================================================
// INSERTS, UPDATES AND DELETES (only run when RUN_UPDATES is true)
// ==========================================================================

// --------------------------------------------------------------------------
// C1. Record a new set of vital signs for case 5
// A nurse enters a ward observation. The builder fills in schema_version and
// checks the time is not in the future; the server-side validator checks
// every value is in range, and the unique index blocks a double submit of the
// same reading.
print("\nC1. Record a new set of vital signs for case 5");
if (RUN_UPDATES) {
  printjson(db.observation_logs.insertOne({
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
    }));
  printjson(db.observation_logs.findOne({ case_id: NumberInt(5), observed_at: ISODate("2026-10-24T09:30:00.000Z") }, { _id: 0 }));
}

// --------------------------------------------------------------------------
// C2. File an in-hospital incident (patient fall, case 9)
// Files a new safety incident. New reports always start as "open". In the API
// the number comes from an atomic counter (repository.nextIncidentNo); the
// demo uses the next free number.
print("\nC2. File an in-hospital incident (patient fall, case 9)");
if (RUN_UPDATES) {
  printjson(db.incident_reports.insertOne({
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
    }));
  printjson(db.incident_reports.findOne({ incident_no: "INC-2026-0009" }, { _id: 0 }));
}

// --------------------------------------------------------------------------
// C3. Write a draft progress note for case 9
// Creates a clinical note as a draft. It becomes part of the record only when
// signed (U2); until then the author can edit (U5) or discard it (D1).
print("\nC3. Write a draft progress note for case 9");
if (RUN_UPDATES) {
  printjson(db.clinical_notes.insertOne({
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
    }));
  printjson(db.clinical_notes.findOne({ case_id: NumberInt(9), note_type: "progress" }, { _id: 0 }));
}

// --------------------------------------------------------------------------
// U4. Start reviewing incident INC-2026-0007
// Moves an open incident to "under_review" and adds a "reviewed" event to its
// timeline. Only open incidents match, so the status can only move forward.
print("\nU4. Start reviewing incident INC-2026-0007");
if (RUN_UPDATES) {
  printjson(db.incident_reports.updateOne(
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
  ));
  printjson(db.incident_reports.findOne({ incident_no: "INC-2026-0007" }, { _id: 0 }));
}

// --------------------------------------------------------------------------
// U1. Close incident INC-2026-0007
// Closes the CT-delay incident: sets the status, records who reviewed it and
// what was done, and adds a "closed" event to its timeline in a single
// update. Already-closed incidents are not matched, so the update cannot run
// twice.
print("\nU1. Close incident INC-2026-0007");
if (RUN_UPDATES) {
  printjson(db.incident_reports.updateOne(
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
  ));
  printjson(db.incident_reports.findOne({ incident_no: "INC-2026-0007" }, { _id: 0 }));
}

// --------------------------------------------------------------------------
// U2. Sign the draft progress note for case 5
// Moves a draft note to signed and records the time. Only drafts match the
// filter, so signing twice changes nothing.
print("\nU2. Sign the draft progress note for case 5");
if (RUN_UPDATES) {
  const draftNoteId = db.clinical_notes.findOne({ case_id: 5, status: "draft" })._id;
  printjson(db.clinical_notes.updateOne(
    { _id: draftNoteId, status: "draft" },
    {
      $set: {
        status: "signed",
        signed_at: ISODate("2026-10-24T06:50:00.000Z"),
        updated_at: ISODate("2026-10-24T06:50:00.000Z")
      }
    }
  ));
  printjson(db.clinical_notes.findOne({ case_id: 5, note_type: "progress" }, { _id: 0 }));
}

// --------------------------------------------------------------------------
// U3. Amend the signed procedure note for case 4
// Corrects a signed note without losing the original: a pipeline update
// copies the current text into the amendments history and replaces it, in one
// atomic step.
print("\nU3. Amend the signed procedure note for case 4");
if (RUN_UPDATES) {
  const procedureNoteId = db.clinical_notes.findOne({ case_id: 4, note_type: "procedure" })._id;
  printjson(db.clinical_notes.updateOne(
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
  ));
  printjson(db.clinical_notes.findOne({ case_id: 4, note_type: "procedure" }, { _id: 0 }));
}

// --------------------------------------------------------------------------
// U5. Edit the draft progress note for case 1
// The author changes the text of a note they have not signed yet. The filter
// requires status "draft" and the same author, so nobody can silently rewrite
// a signed note or someone else's draft.
print("\nU5. Edit the draft progress note for case 1");
if (RUN_UPDATES) {
  const case1DraftId = db.clinical_notes.findOne({ case_id: 1, status: "draft" })._id;
  printjson(db.clinical_notes.updateOne(
    { _id: case1DraftId, status: "draft", author: { doctor_id: NumberInt(2) } },
    {
      $set: {
        body: "Chest pain settling after treatment. Repeat troponin pending. Continue monitoring.",
        updated_at: ISODate("2026-10-24T05:00:00.000Z")
      }
    }
  ));
  printjson(db.clinical_notes.findOne({ case_id: 1, note_type: "progress" }, { _id: 0 }));
}

// --------------------------------------------------------------------------
// D1. Discard the draft progress note for case 1
// Deletes a draft note. Only drafts written by the same author match: signed
// and amended notes are part of the medical record and can never be deleted,
// only amended.
print("\nD1. Discard the draft progress note for case 1");
if (RUN_UPDATES) {
  const case1DraftId = db.clinical_notes.findOne({ case_id: 1, status: "draft" })._id;
  print("before: " + db.clinical_notes.countDocuments({ case_id: NumberInt(1) }));
  printjson(db.clinical_notes.deleteOne({ _id: case1DraftId, status: "draft", author: { doctor_id: NumberInt(2) } }));
  print("after: " + db.clinical_notes.countDocuments({ case_id: NumberInt(1) }));
}

// --------------------------------------------------------------------------
// D2. Remove an observation entered in error
// Removes the reading added by C1, identified by its natural key (case, time,
// source), and only if the same person recorded it. Run C1 first.
print("\nD2. Remove an observation entered in error");
if (RUN_UPDATES) {
  print("before: " + db.observation_logs.countDocuments({ case_id: NumberInt(5) }));
  printjson(db.observation_logs.deleteOne({
      case_id: NumberInt(5),
      observed_at: ISODate("2026-10-24T09:30:00.000Z"),
      source: "ward",
      recorded_by: { staff_id: NumberInt(6) }
    }));
  print("after: " + db.observation_logs.countDocuments({ case_id: NumberInt(5) }));
}

// --------------------------------------------------------------------------
// D3. Purge closed incidents last updated before 09:15
// Housekeeping with deleteMany: removes closed incident reports older than a
// retention date. Open and under-review incidents never match.
print("\nD3. Purge closed incidents last updated before 09:15");
if (RUN_UPDATES) {
  print("before: " + db.incident_reports.countDocuments({}));
  printjson(db.incident_reports.deleteMany({ status: "closed", updated_at: { $lt: ISODate("2026-10-24T03:45:00.000Z") } }));
  print("after: " + db.incident_reports.countDocuments({}));
}
