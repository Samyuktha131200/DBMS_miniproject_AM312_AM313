# MongoDB component

This is the NoSQL part of the Hospital Emergency Management System. It holds
**incident reports**, **vital-sign observation logs** and **clinical notes**, and
refers to the MySQL database by ID (see `docs/DATA_MODEL.md` for the design and
the reasons behind it).

| | |
|---|---|
| Collections | `incident_reports` (8 sample docs), `observation_logs` (32), `clinical_notes` (14), `counters` |
| Validation | `$jsonSchema` validators, strict, on every collection |
| Indexes | 11, including unique, multikey, text, 2dsphere and partial |
| Queries | 6 find, 6 aggregation pipelines, 3 inserts, 5 updates, 3 deletes (`docs/QUERIES.md`) |
| Advanced features | aggregation pipelines (`$setWindowFields`, `$facet`, `$geoNear`, `$unionWith`), full-text search, a multi-document transaction, role-based access control |
| API layer | `lib/repository.js`, used by the Next.js route handlers (`docs/API_INTEGRATION.md`) |

## Requirements

* Node.js 20.12 or newer
* MongoDB 6.0 or newer: a local server (Community Server or Docker) or a MongoDB Atlas cluster

## Setup

```bash
cd mongodb
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
# edit .env: MONGODB_URI=mongodb://localhost:27017 (or your Atlas URI)

npm run setup               # create collections, validators and indexes (safe to re-run)
npm run seed                # load the sample data (skips collections that already have data)
npm run roles               # optional: create the database roles (needs userAdmin; see DATA_MODEL.md §7)
```

`npm run db:init` runs setup and then `seed --reset`. The reset **deletes the
documents in the three collections** and reloads the sample data. Use it only on a
development database.

## Run the queries

```bash
npm run queries -- --list            # every query id
npm run queries                      # all read queries with their results
npm run queries -- news2-board       # one query
npm run queries -- --explain         # also show which index each query used
npm run queries -- --updates         # also run the insert/update/delete demos (changes data)
npm run seed -- --reset              # restore the sample data afterwards
mongosh "mongodb://localhost:27017" queries/queries.mongosh.js   # the same queries in mongosh
```

## Tests

```bash
npm test                             # unit + consistency tests (no server needed)
```

To also run the integration tests against a real server, set `MONGODB_TEST_URI`. The
tests create a throw-away database named `her_test_<random>`, run every query and write
operation against it, and drop it at the end. Your own database is not touched.

```bash
# macOS / Linux
MONGODB_TEST_URI=mongodb://localhost:27017 npm test
# Windows PowerShell
$env:MONGODB_TEST_URI="mongodb://localhost:27017"; npm test
```

| Test file | Checks |
|---|---|
| `schema.test.js` | the sample data passes the validators, and bad documents fail them |
| `queries.test.js` | NEWS2 scoring, and every query against hand-worked expected results |
| `crud.test.js` | insert, update and delete builders: valid documents and safe filters |
| `access.test.js` | the permission matrix and the generated MongoDB role privileges |
| `repository.test.js` | the API layer: role checks, author from session, 400/403/404/409/501 errors, incident counter |
| `consistency.test.js` | every ID matches `../02_sample_data.sql` (MySQL), and no MySQL data is duplicated |
| `scripts.test.js` | setup and seed logic, configuration |
| `queries.integration.test.js` | everything above on a live MongoDB, index use (`explain`), the transaction and the roles |

The transaction's commit path needs a replica set (Atlas, or `mongod --replSet rs0`). On
a standalone server, the test checks that it is refused safely instead.

## Folder structure

```
mongodb/
  data/          sample documents (JSON, linked to the MySQL sample IDs)
  docs/          DATA_MODEL.md, QUERIES.md (generated), API_INTEGRATION.md
  lib/           queries.js (all queries), repository.js (API layer), access.js (roles),
                 db.js (shared connection), news2.js, demos.js, config.js
  queries/       queries.mongosh.js (generated)
  schema/        validators.js, indexes.js
  scripts/       setup, seed, create-roles, run-queries, generators
  tests/         node:test suites and helpers
```

After changing a query or the demos, regenerate the derived files. The tests fail if
they are out of date.

```bash
npm run export:mongosh && npm run docs:queries
```

## Security

* Connection strings and passwords are read from environment variables (`.env`,
  which is git-ignored). Nothing is hard-coded, and URIs are printed with credentials hidden.
* The app connects as a least-privilege user (`hospital_er_app`). It cannot drop
  collections or change validators.
* User text is stored with `$literal` in pipeline updates, so a value starting with
  `$` cannot be read as an operator. IDs are checked to be integers or ObjectIds
  before they reach a query.
* The NEWS2 score is for teaching purposes in a database project, not a clinical tool.
  All sample data is synthetic.
