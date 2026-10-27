'use strict';

/**
 * Database-level role-based access control.
 *
 * Creates (or updates) one MongoDB role per application role, with
 * collection-level privileges generated from lib/access.js:
 *
 *   hospital_er_doctor  read all three collections; write observations and
 *                       notes (incl. amend); file, review and close incidents
 *   hospital_er_nurse   read all three; write observations and notes; file
 *                       incidents; cannot review, close or purge them
 *   hospital_er_admin   incident reports only (read, review, close, purge);
 *                       no access to observations or clinical notes
 *   hospital_er_app     the account the Next.js server connects with: the
 *                       union of the above, and nothing else (it cannot drop
 *                       collections, change validators or create users)
 *
 * Optionally creates login users for these roles. Passwords are read from
 * environment variables and are never stored in the repository; MongoDB
 * stores only a salted SCRAM-SHA-256 hash.
 *
 *   npm run roles                 # create / update the roles only
 *   npm run roles -- --users      # also create users whose *_PASSWORD env var is set
 *   npm run roles -- --print      # print the privileges without connecting
 *
 * Needs a user with the userAdmin role (e.g. the admin who started mongod
 * with --auth). On a server without --auth the roles are still created,
 * but MongoDB only enforces them once authentication is switched on.
 */

const { ROLES, dbRoleName, dbPrivilegesFor } = require('../lib/access');
const { loadEnv, getConfig, redactUri, requireDriver, DEFAULT_DB_NAME } = require('../lib/config');

const APP_ROLE = 'hospital_er_app';

/** Users that --users can create: [username, roles, env var holding the password]. */
const USERS = [
  ['er_app', [APP_ROLE], 'MONGODB_APP_PASSWORD'],
  ['er_doctor_demo', [dbRoleName('doctor')], 'MONGODB_DOCTOR_PASSWORD'],
  ['er_nurse_demo', [dbRoleName('nurse')], 'MONGODB_NURSE_PASSWORD'],
  ['er_admin_demo', [dbRoleName('admin')], 'MONGODB_ADMIN_PASSWORD'],
];

/** Every role definition, ready for createRole / updateRole. */
function roleDefinitions(dbName) {
  const defs = ROLES.map((role) => ({ role: dbRoleName(role), privileges: dbPrivilegesFor(role, dbName), roles: [] }));
  // the app role = union of the application roles (inherits them)
  defs.push({ role: APP_ROLE, privileges: [], roles: ROLES.map((r) => ({ role: dbRoleName(r), db: dbName })) });
  return defs;
}

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<Array<{role:string, action:'created'|'updated'}>>}
 */
async function createRoles(db, { log = console.log } = {}) {
  const summary = [];
  for (const def of roleDefinitions(db.databaseName)) {
    const info = await db.command({ rolesInfo: def.role });
    const exists = info.roles && info.roles.length > 0;
    if (exists) {
      await db.command({ updateRole: def.role, privileges: def.privileges, roles: def.roles });
    } else {
      await db.command({ createRole: def.role, privileges: def.privileges, roles: def.roles });
    }
    const action = exists ? 'updated' : 'created';
    log(`${action === 'created' ? 'Created' : 'Updated'} role ${def.role}`);
    summary.push({ role: def.role, action });
  }
  return summary;
}

async function createUsers(db, { env = process.env, log = console.log } = {}) {
  const summary = [];
  for (const [user, roles, passwordVar] of USERS) {
    const pwd = env[passwordVar];
    if (!pwd) {
      log(`Skipped user ${user}: ${passwordVar} is not set`);
      continue;
    }
    if (pwd.length < 12) throw new Error(`${passwordVar} must be at least 12 characters`);
    const info = await db.command({ usersInfo: user });
    const roleRefs = roles.map((role) => ({ role, db: db.databaseName }));
    if (info.users && info.users.length) {
      await db.command({ updateUser: user, pwd, roles: roleRefs });
      log(`Updated user ${user} (${roles.join(', ')})`);
    } else {
      await db.command({ createUser: user, pwd, roles: roleRefs, mechanisms: ['SCRAM-SHA-256'] });
      log(`Created user ${user} (${roles.join(', ')})`);
    }
    summary.push(user);
  }
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  loadEnv();
  if (args.includes('--print')) {
    const dbName = process.env.MONGODB_DB || DEFAULT_DB_NAME;
    console.log(JSON.stringify(roleDefinitions(dbName), null, 2));
    return;
  }
  const { uri, dbName } = getConfig();
  const { MongoClient } = requireDriver();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connecting to ${redactUri(uri)} (database "${dbName}")...`);
  await client.connect();
  try {
    const db = client.db(dbName);
    await createRoles(db);
    if (args.includes('--users')) await createUsers(db);
    console.log('Roles ready. Check them in mongosh with: db.getRoles({ showPrivileges: true })');
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Creating roles failed: ${err.message}`);
    if (err.code === 8000) {
      console.error('MongoDB Atlas does not allow createRole from a connection. Create the custom roles in the Atlas UI\n'
        + '(Database Access -> Custom Roles) using the privileges printed by: npm run roles -- --print');
    } else if (err.code === 13) {
      console.error('The connected user needs the userAdmin role on this database to create roles.');
    }
    process.exitCode = 1;
  });
}

module.exports = { createRoles, createUsers, roleDefinitions, APP_ROLE, USERS };
