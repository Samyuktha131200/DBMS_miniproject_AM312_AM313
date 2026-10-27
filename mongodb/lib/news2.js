'use strict';

/**
 * NEWS2 (National Early Warning Score 2, Royal College of Physicians, 2017).
 *
 * The thresholds below are the single source of truth. They are used to:
 *   - build the MongoDB $switch expressions in the aggregation pipeline
 *   - build the "red score" filter for the abnormal-observations query
 *   - score observations in plain JavaScript (tests and API checks)
 * so the database and the application can never disagree.
 *
 * Uses SpO2 Scale 1 (the standard scale). Scale 2 is for patients with
 * confirmed hypercapnic respiratory failure and is not modelled here.
 */

/**
 * Each band is [upperInclusive, points]; the first band whose upper bound
 * is >= the value applies. `null` upper bound means "anything higher".
 */
const BANDS = {
  resp_rate: [[8, 3], [11, 1], [20, 0], [24, 2], [null, 3]],
  spo2: [[91, 3], [93, 2], [95, 1], [null, 0]],
  systolic: [[90, 3], [100, 2], [110, 1], [219, 0], [null, 3]],
  heart_rate: [[40, 3], [50, 1], [90, 0], [110, 1], [130, 2], [null, 3]],
  temp_c: [[35.0, 3], [36.0, 1], [38.0, 0], [39.0, 1], [null, 2]],
};

/** Where each parameter lives in an observation_logs document. */
const FIELDS = {
  resp_rate: 'vitals.resp_rate',
  spo2: 'vitals.spo2',
  on_supplemental_o2: 'vitals.on_supplemental_o2',
  systolic: 'vitals.bp.systolic',
  heart_rate: 'vitals.heart_rate',
  consciousness: 'vitals.consciousness',
  temp_c: 'vitals.temp_c',
};

const PARAMETERS = Object.keys(FIELDS);

/** NEWS2 clinical risk and the response it calls for. */
const RISK_LEVELS = {
  low: 'Low: routine ward monitoring',
  'low-medium': 'Low-medium: urgent ward-based review (a single parameter scored 3)',
  medium: 'Medium: urgent review by a clinician, at least hourly observations',
  high: 'High: emergency assessment, continuous monitoring',
};

const bandScore = (bands, value) => {
  for (const [upper, points] of bands) if (upper === null || value <= upper) return points;
  throw new Error('unreachable');
};

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);

/** Score one parameter; returns null when the value was not recorded. */
function scoreParameter(param, value) {
  if (value === undefined || value === null) return null;
  if (param === 'on_supplemental_o2') return value ? 2 : 0;
  if (param === 'consciousness') return value === 'A' ? 0 : 3;
  return bandScore(BANDS[param], value);
}

function riskFor(total, maxSingle) {
  if (total >= 7) return 'high';
  if (total >= 5) return 'medium';
  if (maxSingle === 3) return 'low-medium';
  return 'low';
}

/**
 * Score a whole observation document.
 * @returns {{components:Object, total:number|null, max_single:number|null, risk:string|null}}
 *   total/risk are null when any of the seven parameters is missing.
 */
function scoreObservation(doc) {
  const components = {};
  for (const p of PARAMETERS) components[p] = scoreParameter(p, get(doc, FIELDS[p]));
  const values = Object.values(components);
  if (values.includes(null)) return { components, total: null, max_single: null, risk: null };
  const total = values.reduce((a, b) => a + b, 0);
  const maxSingle = Math.max(...values);
  return { components, total, max_single: maxSingle, risk: riskFor(total, maxSingle) };
}

// ---- MongoDB expression builders ----------------------------------------

const missing = (path) => ({ $eq: [{ $type: `$${path}` }, 'missing'] });

/** $switch expression scoring one parameter, or null if it is missing. */
function scoreExpression(param) {
  const path = FIELDS[param];
  let expr;
  if (param === 'on_supplemental_o2') {
    expr = { $cond: [{ $eq: [`$${path}`, true] }, 2, 0] };
  } else if (param === 'consciousness') {
    expr = { $cond: [{ $eq: [`$${path}`, 'A'] }, 0, 3] };
  } else {
    const bands = BANDS[param];
    expr = {
      $switch: {
        branches: bands
          .filter(([upper]) => upper !== null)
          .map(([upper, points]) => ({ case: { $lte: [`$${path}`, upper] }, then: points })),
        default: bands[bands.length - 1][1],
      },
    };
  }
  return { $cond: [missing(path), null, expr] };
}

/**
 * Pipeline stages that add `news2: {components, total, max_single, risk}`
 * to each observation document.
 */
function news2Stages() {
  const components = Object.fromEntries(PARAMETERS.map((p) => [p, scoreExpression(p)]));
  const refs = PARAMETERS.map((p) => `$news2.components.${p}`);
  return [
    { $set: { news2: { components } } },
    {
      $set: {
        'news2.total': { $cond: [{ $in: [null, refs] }, null, { $add: refs }] },
        'news2.max_single': { $cond: [{ $in: [null, refs] }, null, { $max: refs }] },
      },
    },
    {
      $set: {
        'news2.risk': {
          $switch: {
            branches: [
              { case: { $eq: ['$news2.total', null] }, then: null },
              { case: { $gte: ['$news2.total', 7] }, then: 'high' },
              { case: { $gte: ['$news2.total', 5] }, then: 'medium' },
              { case: { $eq: ['$news2.max_single', 3] }, then: 'low-medium' },
            ],
            default: 'low',
          },
        },
      },
    },
  ];
}

/**
 * Query filter for observations where ANY single parameter scores 3
 * ("red score"), derived from the same bands.
 */
function redScoreFilter() {
  const or = [];
  for (const [param, bands] of Object.entries(BANDS)) {
    const path = FIELDS[param];
    bands.forEach(([upper, points], i) => {
      if (points !== 3) return;
      if (upper !== null && i === 0) or.push({ [path]: { $lte: upper } });
      else if (upper === null) or.push({ [path]: { $gt: bands[i - 1][0] } });
      else or.push({ [path]: { $gt: bands[i - 1][0], $lte: upper } });
    });
  }
  or.push({ [FIELDS.consciousness]: { $in: ['C', 'V', 'P', 'U'] } });
  return { $or: or };
}

module.exports = {
  BANDS, FIELDS, PARAMETERS, RISK_LEVELS,
  scoreParameter, scoreObservation, riskFor,
  scoreExpression, news2Stages, redScoreFilter,
};
