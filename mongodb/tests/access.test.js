'use strict';

/**
 * Role-based access control: the permission table, the MongoDB role
 * privileges generated from it, and who gets recorded as the author.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const access = require('../lib/access');
const { roleDefinitions, APP_ROLE, USERS } = require('../scripts/create-roles');
const { COLLECTION_NAMES } = require('../schema');

const doctor = { role: 'doctor', doctor_id: 2 };
const nurse = { role: 'nurse', staff_id: 6 };
const admin = { role: 'admin' };

test('permission matrix: what each role may do', () => {
  assert.deepEqual(access.permissionsFor('nurse'), [
    'observations:read', 'observations:create', 'observations:delete',
    'notes:read', 'notes:create', 'notes:edit', 'notes:sign', 'notes:delete',
    'incidents:read', 'incidents:create',
    'reports:clinical', 'reports:operational',
  ]);
  assert.deepEqual(access.permissionsFor('admin'), [
    'incidents:read', 'incidents:review', 'incidents:close', 'incidents:purge', 'reports:operational',
  ]);
  // doctors can do everything except purge
  assert.deepEqual(
    Object.keys(access.PERMISSIONS).filter((a) => !access.can(doctor, a)),
    ['incidents:purge'],
  );
});

test('clinical data is never visible to admin; purge is admin-only', () => {
  for (const a of ['observations:read', 'notes:read', 'reports:clinical']) assert.equal(access.can(admin, a), false, a);
  assert.equal(access.can(nurse, 'incidents:purge'), false);
  assert.equal(access.can(nurse, 'notes:amend'), false);
  assert.equal(access.can(nurse, 'incidents:close'), false);
  assert.throws(() => access.assertCan(nurse, 'incidents:close'), (e) => e.status === 403);
  assert.throws(() => access.can(nurse, 'no:such'), /unknown action/);
});

test('users must be signed in with a known role and a linked MySQL id', () => {
  assert.throws(() => access.assertCan(null, 'notes:read'), (e) => e.status === 403);
  assert.throws(() => access.assertCan({ role: 'patient' }, 'notes:read'), /unknown role/);
  assert.throws(() => access.assertCan({ role: 'doctor' }, 'notes:read'), /doctor_id/);
  assert.throws(() => access.assertCan({ role: 'nurse', staff_id: 0 }, 'notes:read'), /staff_id/);
});

test('actorRef takes the author from the session, never from input', () => {
  assert.deepEqual(access.actorRef(doctor), { doctor_id: 2 });
  assert.deepEqual(access.actorRef(nurse), { staff_id: 6 });
  assert.deepEqual(access.actorRef({ role: 'admin', staff_id: 1 }), { staff_id: 1 });
  assert.throws(() => access.actorRef(admin), /not linked/);
});

test('MongoDB role privileges are generated from the same table', () => {
  const defs = roleDefinitions('hospital_emergency_management');
  const byRole = Object.fromEntries(defs.map((d) => [d.role, d]));
  const priv = (role) => Object.fromEntries(byRole[role].privileges.map((p) => [p.resource.collection, p.actions]));

  assert.deepEqual(priv('hospital_er_admin'), { incident_reports: ['find', 'remove', 'update'] });
  assert.deepEqual(priv('hospital_er_nurse'), {
    clinical_notes: ['find', 'insert', 'remove', 'update'],
    counters: ['find', 'insert', 'update'],
    incident_reports: ['find', 'insert'],
    observation_logs: ['find', 'insert', 'remove'],
  });
  assert.deepEqual(priv('hospital_er_doctor').incident_reports, ['find', 'insert', 'update']);
  // the app account inherits the three roles and has no privileges of its own
  assert.deepEqual(byRole[APP_ROLE].privileges, []);
  assert.deepEqual(byRole[APP_ROLE].roles.map((r) => r.role).sort(), ['hospital_er_admin', 'hospital_er_doctor', 'hospital_er_nurse']);
});

test('no role gets admin-level actions or touches unknown collections', () => {
  const allowedCollections = new Set([...Object.values(COLLECTION_NAMES), 'counters']);
  const allowedActions = new Set(['find', 'insert', 'update', 'remove']);
  for (const def of roleDefinitions('x')) {
    for (const p of def.privileges) {
      assert.equal(p.resource.db, 'x');
      assert.ok(allowedCollections.has(p.resource.collection), p.resource.collection);
      for (const a of p.actions) assert.ok(allowedActions.has(a), `${def.role}: ${a}`);
    }
  }
});

test('database users take passwords from environment variables only', () => {
  for (const [user, roles, envVar] of USERS) {
    assert.match(envVar, /^MONGODB_[A-Z]+_PASSWORD$/, user);
    assert.equal(roles.length, 1);
  }
});
