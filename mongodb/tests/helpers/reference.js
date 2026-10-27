'use strict';

/**
 * Plain-JavaScript reference implementations of the demo queries,
 * computed directly over the sample JSON files.
 *
 * They are written independently of the MongoDB pipelines (loops and
 * array methods, no pipeline code) so they can be used to:
 *   - check the expected outputs against hand-worked numbers (unit tests)
 *   - check the real MongoDB results (integration tests)
 *   - produce the "expected output" sections in docs/QUERIES.md
 */

const path = require('node:path');
const { loadJsonDocuments } = require('../../lib/load-json');
const { scoreObservation } = require('../../lib/news2');
const { HOSPITAL_LOCATION } = require('../../lib/queries');

const DATA = path.join(__dirname, '..', '..', 'data');
const load = (name) => loadJsonDocuments(path.join(DATA, `${name}.json`));

const by = (...keys) => (a, b) => {
  for (const k of keys) {
    const [field, dir] = k.startsWith('-') ? [k.slice(1), -1] : [k, 1];
    const av = field.split('.').reduce((v, p) => v?.[p], a);
    const bv = field.split('.').reduce((v, p) => v?.[p], b);
    const x = av instanceof Date ? av.getTime() : av;
    const y = bv instanceof Date ? bv.getTime() : bv;
    if (x === y) continue;
    if (x === null || x === undefined) return -dir;
    if (y === null || y === undefined) return dir;
    return x < y ? -dir : dir;
  }
  return 0;
};
const minutesBetween = (a, b) => Math.round((b - a) / 60000);
/** Round to 1 decimal the way MongoDB's $round does: halves go to the even digit. */
const round1 = (x) => {
  const y = x * 10;
  const f = Math.floor(y);
  if (Math.abs(y - f - 0.5) < 1e-9) return (f % 2 === 0 ? f : f + 1) / 10;
  return Math.round(y) / 10;
};
const inRange = (d, { from, to } = {}) => (!from || d >= from) && (!to || d < to);

function createReference() {
  const incidents = load('incident_reports');
  const observations = load('observation_logs');
  const notes = load('clinical_notes');

  const strip = ({ schema_version, ...rest }) => rest;

  return {
    observationsForCase: (caseId) =>
      observations.filter((o) => o.case_id === caseId).sort(by('observed_at')).map(strip),

    redFlagObservations: (range) =>
      observations
        .filter((o) => inRange(o.observed_at, range))
        .filter((o) => Object.values(scoreObservation(o).components).includes(3))
        .sort(by('-observed_at'))
        .map(({ case_id, observed_at, source, vitals }) => ({ case_id, observed_at, source, vitals })),

    openIncidents: () =>
      incidents
        .filter((i) => ['open', 'under_review'].includes(i.status))
        .sort(by('-occurred_at'))
        .map(({ incident_no, category, incident_type, severity, status, case_ids, occurred_at, summary }) =>
          ({ incident_no, category, incident_type, severity, status, case_ids, occurred_at, summary })),

    incidentsForCase: (caseId) =>
      incidents.filter((i) => i.case_ids.includes(caseId)).sort(by('occurred_at')).map(strip),

    draftNotesQueue: () =>
      notes.filter((n) => n.status === 'draft').sort(by('created_at'))
        .map(({ case_id, author, title, created_at }) => ({ case_id, author, title, created_at })),

    news2Board: ({ caseId, ...range } = {}) => {
      const scored = observations
        .filter((o) => (!caseId || o.case_id === caseId) && inRange(o.observed_at, range))
        .map((o) => ({ o, s: scoreObservation(o) }))
        .filter(({ s }) => s.total !== null)
        .sort((a, b) => a.o.case_id - b.o.case_id || a.o.observed_at - b.o.observed_at);
      const rows = new Map();
      for (const { o, s } of scored) {
        const row = rows.get(o.case_id) || { case_id: o.case_id, history: [] };
        const prev = row.history[row.history.length - 1];
        const change = prev ? s.total - prev.score : null;
        row.history.push({ observed_at: o.observed_at, score: s.total, change });
        row.latest = { observed_at: o.observed_at, source: o.source, score: s.total, risk: s.risk, change };
        rows.set(o.case_id, row);
      }
      return [...rows.values()]
        .map((r) => ({
          case_id: r.case_id,
          latest: r.latest,
          peak_score: Math.max(...r.history.map((h) => h.score)),
          deterioration_detected: r.history.some((h) => h.change !== null && h.change >= 2),
          scored_observations: r.history.length,
          history: r.history,
        }))
        .sort(by('-latest.score', '-peak_score', 'case_id'));
    },

    responseTimes: ({ targetMinutes = 15, ...range } = {}) => {
      const rows = incidents
        .filter((i) => i.category === 'prehospital' && inRange(i.occurred_at, range))
        .map((i) => {
          const t = Object.fromEntries(i.timeline.map((e) => [e.event, e.at]));
          const minutes = {
            call_to_dispatch: minutesBetween(t.call_received, t.dispatched),
            call_to_scene: minutesBetween(t.call_received, t.on_scene),
            at_scene: minutesBetween(t.on_scene, t.left_scene),
            transport: minutesBetween(t.left_scene, t.arrived_hospital),
            call_to_hospital: minutesBetween(t.call_received, t.arrived_hospital),
          };
          return {
            incident_no: i.incident_no, case_ids: i.case_ids, incident_type: i.incident_type,
            severity: i.severity, minutes, target_breached: minutes.call_to_scene > targetMinutes,
          };
        })
        .sort(by('-minutes.call_to_scene', 'incident_no'));
      const avg = (f) => round1(rows.reduce((s, r) => s + r.minutes[f], 0) / rows.length);
      const severities = [...new Set(rows.map((r) => r.severity))].sort();
      return {
        incidents: rows,
        summary: {
          incidents: rows.length,
          avg_call_to_scene: avg('call_to_scene'),
          max_call_to_scene: Math.max(...rows.map((r) => r.minutes.call_to_scene)),
          avg_at_scene: avg('at_scene'),
          avg_transport: avg('transport'),
          avg_call_to_hospital: avg('call_to_hospital'),
          target_breaches: rows.filter((r) => r.target_breached).length,
        },
        by_severity: severities.map((severity) => {
          const g = rows.filter((r) => r.severity === severity);
          return { severity, incidents: g.length, avg_call_to_scene: round1(g.reduce((s, r) => s + r.minutes.call_to_scene, 0) / g.length) };
        }),
        target_minutes: targetMinutes,
      };
    },

    incidentTrends: ({ asOf, ...range }) => {
      const rows = incidents.filter((i) => inRange(i.occurred_at, range));
      const countBy = (fn, label) => {
        const m = new Map();
        for (const r of rows) m.set(fn(r), (m.get(fn(r)) || 0) + 1);
        return [...m.entries()].map(([k, n]) => ({ [label]: k, incidents: n })).sort(by(label));
      };
      const istHour = (d) => new Date(d.getTime() + 330 * 60000).getUTCHours();
      const istDay = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
      const typeMap = new Map();
      for (const r of rows) {
        const k = `${r.category}|${r.incident_type}`;
        typeMap.set(k, (typeMap.get(k) || 0) + 1);
      }
      const harmRows = rows.filter((r) => r.category === 'in_hospital');
      const harm = new Map();
      for (const r of harmRows) harm.set(r.harm_level, (harm.get(r.harm_level) || 0) + 1);
      return {
        total: rows.length,
        by_type: [...typeMap.entries()]
          .map(([k, n]) => ({ category: k.split('|')[0], incident_type: k.split('|')[1], incidents: n }))
          .sort(by('-incidents', 'category', 'incident_type')),
        by_severity: countBy((r) => r.severity, 'severity'),
        by_status: countBy((r) => r.status, 'status'),
        by_hour: countBy((r) => istHour(r.occurred_at), 'hour'),
        by_day: countBy((r) => istDay(r.occurred_at), 'day'),
        in_hospital_harm: [...harm.entries()].map(([k, n]) => ({ harm_level: k, incidents: n })).sort(by('harm_level')),
        open_items: rows
          .filter((r) => r.status !== 'closed')
          .map((r) => ({
            incident_no: r.incident_no, incident_type: r.incident_type, severity: r.severity, status: r.status,
            // $dateDiff counts hour boundaries crossed, i.e. whole UTC hours
            hours_open: Math.floor(asOf.getTime() / 3600000) - Math.floor(r.reported_at.getTime() / 3600000),
          }))
          .sort(by('-hours_open', 'incident_no')),
      };
    },

    incidentHotspots: ({ center = HOSPITAL_LOCATION, maxKm = 30 } = {}) => {
      // great-circle distance on a sphere of radius 6378.1 km (MongoDB's radius)
      const R = 6378.1;
      const rad = (x) => (x * Math.PI) / 180;
      const [lon1, lat1] = center.coordinates;
      const dist = ([lon2, lat2]) => {
        const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
          Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
      };
      const nearest = incidents
        .filter((i) => i.category === 'prehospital' && i.location.geo)
        .map((i) => ({
          incident_no: i.incident_no, incident_type: i.incident_type, severity: i.severity,
          distance_km: round1(dist(i.location.geo.coordinates)),
          place: i.location.description, coordinates: i.location.geo.coordinates,
        }))
        .filter((r) => r.distance_km <= maxKm)
        .sort(by('distance_km'));
      const bands = [['0-5', 0, 5], ['5-10', 5, 10], ['10-20', 10, 20], ['20+', 20, Infinity]];
      return {
        nearest,
        by_distance_band: bands
          .map(([band_km, lo, hi]) => {
            const g = nearest.filter((r) => r.distance_km >= lo && r.distance_km < hi);
            return { band_km, incidents: g.length, incident_nos: g.map((r) => r.incident_no) };
          })
          .filter((b) => b.incidents > 0),
      };
    },

    vitalsSummary: () => {
      const cases = [...new Set(observations.map((o) => o.case_id))].sort((a, b) => a - b);
      return cases.map((caseId) => {
        const obs = observations.filter((o) => o.case_id === caseId).sort(by('observed_at'));
        const v = (f) => obs.map((o) => f(o.vitals)).filter((x) => x !== undefined);
        const hr = v((x) => x.heart_rate);
        return {
          case_id: caseId,
          observations: obs.length,
          sources: [...new Set(obs.map((o) => o.source))].sort(),
          first_at: obs[0].observed_at,
          last_at: obs[obs.length - 1].observed_at,
          monitored_minutes: minutesBetween(obs[0].observed_at, obs[obs.length - 1].observed_at),
          heart_rate: { min: Math.min(...hr), max: Math.max(...hr), avg: round1(hr.reduce((a, b) => a + b, 0) / hr.length) },
          lowest_spo2: Math.min(...v((x) => x.spo2)),
          highest_resp_rate: Math.max(...v((x) => x.resp_rate)),
          lowest_systolic: Math.min(...v((x) => x.bp?.systolic)),
          highest_temp_c: v((x) => x.temp_c).length ? Math.max(...v((x) => x.temp_c)) : null,
          pain: { first: obs[0].vitals.pain_score ?? null, last: obs[obs.length - 1].vitals.pain_score ?? null },
          oxygen_readings: obs.filter((o) => o.vitals.on_supplemental_o2).length,
        };
      });
    },

    caseTimeline: (caseId) => {
      const s = (x) => (x === undefined || x === null ? '?' : String(x));
      const rows = [
        ...observations.filter((o) => o.case_id === caseId).map((o) => ({
          at: o.observed_at, kind: 'observation', detail: o.source,
          summary: `HR ${s(o.vitals.heart_rate)}, RR ${s(o.vitals.resp_rate)}, SpO2 ${s(o.vitals.spo2)}%` +
            `${o.vitals.on_supplemental_o2 ? ' on O2' : ''}, BP ${s(o.vitals.bp?.systolic)}/${s(o.vitals.bp?.diastolic)}`,
        })),
        ...notes.filter((n) => n.case_id === caseId).map((n) => ({ at: n.created_at, kind: 'note', detail: n.note_type, summary: n.title })),
        ...incidents.filter((i) => i.case_ids.includes(caseId)).map((i) => ({
          at: i.occurred_at, kind: 'incident', detail: i.incident_type,
          summary: `${i.incident_no} (${i.severity}): ${i.summary}`,
        })),
      ];
      return rows.sort(by('at', 'kind'));
    },
  };
}

module.exports = { createReference };
