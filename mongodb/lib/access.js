'use strict';

/**
 * Role-based access control for the MongoDB part of the system.
 *
 * ONE table (PERMISSIONS) decides what each role may do. It is enforced
 * in two places, both generated from this table so they cannot disagree:
 *
 *   1. In the application: lib/repository.js calls `assertCan(user, action)`
 *      before every query, and returns 403 if the role lacks the permission.
 *   2. In the database: scripts/create-roles.js turns the same table into
 *      MongoDB roles (hospital_er_doctor, hospital_er_nurse, hospital_er_admin)
 *      with collection-level privileges, so even a direct mongosh login with
 *      a nurse account cannot purge incident reports.
 *
 * Roles match the people in the MySQL schema:
 *   doctor -> DOCTOR table          (user carries doctor_id)
 *   nurse  -> NURSE_STAFF table     (user carries staff_id; nurses, paramedics, technicians)
 *   admin  -> hospital administration / quality & safety office (no clinical data)
 */

const ROLES = Object.freeze(['doctor', 'nurse', 'admin']);

/**
 * action -> { roles allowed, MongoDB privileges the action needs }.
 * `db` lists [collection, [MongoDB privilege actions]] pairs.
 */
const PERMISSIONS = Object.freeze({
  // ---- observations (vital signs) -----------------------------------------
  'observations:read': { roles: ['doctor', 'nurse'], db: [['observation_logs', ['find']]] },
  'observations:create': { roles: ['doctor', 'nurse'], db: [['observation_logs', ['insert']]] },
  'observations:delete': { roles: ['doctor', 'nurse'], db: [['observation_logs', ['remove']]] },

  // ---- clinical notes -------------------------------------------------------
  'notes:read': { roles: ['doctor', 'nurse'], db: [['clinical_notes', ['find']]] },
  'notes:create': { roles: ['doctor', 'nurse'], db: [['clinical_notes', ['insert']]] },
  'notes:edit': { roles: ['doctor', 'nurse'], db: [['clinical_notes', ['update']]] },
  'notes:sign': { roles: ['doctor', 'nurse'], db: [['clinical_notes', ['update']]] },
  'notes:amend': { roles: ['doctor'], db: [['clinical_notes', ['update']]] },
  'notes:delete': { roles: ['doctor', 'nurse'], db: [['clinical_notes', ['remove']]] },

  // ---- incident reports -------------------------------------------------------
  'incidents:read': { roles: ['doctor', 'nurse', 'admin'], db: [['incident_reports', ['find']]] },
  'incidents:create': {
    roles: ['doctor', 'nurse'],
    db: [['incident_reports', ['insert']], ['counters', ['find', 'insert', 'update']]],
  },
  'incidents:review': { roles: ['doctor', 'admin'], db: [['incident_reports', ['update']]] },
  'incidents:close': { roles: ['doctor', 'admin'], db: [['incident_reports', ['update']]] },
  'incidents:purge': { roles: ['admin'], db: [['incident_reports', ['remove']]] },

  // ---- reports / dashboards (aggregations) ------------------------------------
  // NEWS2 board, vitals summary and case timeline read patient observations
  'reports:clinical': {
    roles: ['doctor', 'nurse'],
    db: [['observation_logs', ['find']], ['clinical_notes', ['find']], ['incident_reports', ['find']]],
  },
  // response times, incident trends and hotspots only read incident reports
  'reports:operational': { roles: ['doctor', 'nurse', 'admin'], db: [['incident_reports', ['find']]] },
});

class AccessDeniedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccessDeniedError';
    this.status = 403;
  }
}

/**
 * Check and normalise the signed-in user passed in by the API layer.
 * A doctor must carry doctor_id, a nurse staff_id; admin needs neither.
 * @returns {{role:string, doctor_id?:number, staff_id?:number}}
 */
function requireUser(user) {
  if (!user || !ROLES.includes(user.role)) throw new AccessDeniedError('not signed in or unknown role');
  const idKey = { doctor: 'doctor_id', nurse: 'staff_id' }[user.role];
  if (idKey && !(Number.isInteger(user[idKey]) && user[idKey] > 0)) {
    throw new AccessDeniedError(`${user.role} account is not linked to a ${idKey}`);
  }
  return user;
}

function can(user, action) {
  const p = PERMISSIONS[action];
  if (!p) throw new Error(`unknown action "${action}"`);
  return Boolean(user && p.roles.includes(user.role));
}

function assertCan(user, action) {
  requireUser(user);
  if (!can(user, action)) throw new AccessDeniedError(`role "${user.role}" may not ${action.replace(':', ' ')}`);
}

/**
 * The person reference ({doctor_id} / {staff_id}) for the signed-in user.
 * The API never accepts "recorded_by" / "author" from the request body:
 * it is always taken from the session, so nobody can write as someone else.
 */
function actorRef(user) {
  requireUser(user);
  if (user.role === 'doctor') return { doctor_id: user.doctor_id };
  if (user.role === 'nurse') return { staff_id: user.staff_id };
  // An admin is recorded by staff_id when the account has one (e.g. the
  // quality & safety officer closing an incident). Admins never author
  // clinical records: the PERMISSIONS table gives them no note/observation writes.
  if (Number.isInteger(user.staff_id) && user.staff_id > 0) return { staff_id: user.staff_id };
  throw new AccessDeniedError('this admin account is not linked to a staff_id');
}

/** MongoDB role name for an application role. */
const dbRoleName = (role) => `hospital_er_${role}`;

/**
 * Build the createRole privileges for one role from PERMISSIONS:
 * merges every action the role has into one privilege per collection.
 */
function dbPrivilegesFor(role, dbName) {
  const byCollection = new Map();
  for (const p of Object.values(PERMISSIONS)) {
    if (!p.roles.includes(role)) continue;
    for (const [collection, actions] of p.db) {
      if (!byCollection.has(collection)) byCollection.set(collection, new Set());
      actions.forEach((a) => byCollection.get(collection).add(a));
    }
  }
  return [...byCollection.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([collection, actions]) => ({
      resource: { db: dbName, collection },
      actions: [...actions].sort(),
    }));
}

/** Actions each role may perform (for docs and the UI to hide buttons). */
function permissionsFor(role) {
  return Object.entries(PERMISSIONS).filter(([, p]) => p.roles.includes(role)).map(([a]) => a);
}

module.exports = {
  ROLES, PERMISSIONS, AccessDeniedError,
  requireUser, can, assertCan, actorRef, dbRoleName, dbPrivilegesFor, permissionsFor,
};
