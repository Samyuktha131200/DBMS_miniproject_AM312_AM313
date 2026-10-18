# Hospital Emergency Room Management System

## 1. Project Overview

The **Hospital Emergency Room Management System** is a database-driven application designed to organize and manage hospital emergency room operations. It aims to improve the management of patient information, doctor assignments, appointments, and medical records while maintaining data consistency and integrity.

The project focuses on applying database management concepts to a real-world healthcare scenario, going beyond basic CRUD operations through advanced database features and meaningful queries.

## 2. Objectives

- Design and implement a relational database for hospital management.
- Maintain relationships between patients, doctors, departments, appointments, and medical records.
- Enforce data integrity using primary keys, foreign keys, constraints, and indexes.
- Demonstrate SQL operations, including joins, aggregate functions, subqueries, and transactions.
- Implement advanced database features such as views, stored procedures, and triggers.
- Develop a web-based interface using Next.js.
- Integrate a second database paradigm appropriate to the project's requirements.
- Provide a foundation for secure, role-based access to hospital management functionality.

## 3. Technology Stack

| Component | Technology |
|---|---|
| Relational database | MySQL |
| Frontend | Next.js (planned) |
| Backend/API | Next.js Route Handlers or API routes (planned) |
| Second database | To be selected and justified |
| Database design | Draw.io and ERDPlus |
| Version control | Git and GitHub |

## 4. Database Design

The project includes an ER diagram and relational schema to document the database structure.

The initial SQL implementation covers the following entities:

- **Department:** Department details and location.
- **Patient:** Patient demographic and contact information.
- **Doctor:** Doctor details, specialization, availability, and department.
- **Appointment:** Appointment scheduling, patient-doctor relationships, and status.
- **Medical Record:** Patient diagnosis, treatment, and associated doctor and appointment.

Primary keys, foreign keys, uniqueness constraints, validation constraints, and indexes are used to maintain data integrity and support common queries.

The final implementation will be aligned with the project's ER diagram and relational schema.

## 5. SQL Implementation

The `sql/` directory contains the database implementation scripts.

| File | Description |
|---|---|
| `01_schema.sql` | Creates the database, tables, constraints, and indexes. |
| `02_sample_data.sql` | Inserts synthetic data for testing. |
| `03_advanced_features.sql` | Defines a view, stored procedure, and trigger. |
| `04_queries.sql` | Demonstrates joins, grouping, subqueries, updates, deletes, and transactions. |

### SQL concepts demonstrated

- DDL: `CREATE` and index creation.
- DML: `INSERT`, `UPDATE`, `DELETE`, and `SELECT`.
- Primary and foreign keys.
- Data validation and integrity constraints.
- Joins, aggregate functions, `GROUP BY`, `HAVING`, and subqueries.
- Transactions.
- Views.
- Stored procedures.
- Triggers.
- Indexing.

Additional SQL operations, including `ALTER` and `DROP`, will be documented and demonstrated as the implementation progresses.

## 6. Setup and Execution

### Prerequisites

- Git
- MySQL Server 8.0.16 or later
- MySQL Workbench or another MySQL client

### Clone the repository

```bash
git clone https://github.com/Samyuktha131200/DBMS_miniproject_AM312_AM313.git
cd DBMS_miniproject_AM312_AM313
```

### Execute the SQL scripts

1. Start MySQL Server and connect using MySQL Workbench.
2. Open `sql/01_schema.sql` and execute it.
3. Execute `sql/02_sample_data.sql` to insert synthetic test data.
4. Execute `sql/03_advanced_features.sql` to create the view, procedure, and trigger.
5. Execute `sql/04_queries.sql` to test the database operations.

Run the scripts in the specified order because later scripts depend on the tables created earlier.

**Note:** These scripts are intended for initial setup. For a fresh repeatable test, reset the development database before rerunning the schema and sample-data scripts. Do not use real patient information in the sample database.

## 7. Advanced Database Features

The project demonstrates the following advanced database concepts:

1. **Transactions:** Group related database operations into a single transaction.
2. **Views:** Present appointment information by combining patient, doctor, and department data.
3. **Stored Procedures:** Retrieve appointments for a specified patient.
4. **Triggers:** Prevent appointment insertion when the assigned doctor is marked unavailable.
5. **Indexes:** Improve performance for common appointment and department lookups.

Further scheduling validation and concurrency handling will be considered as the system develops.

## 8. Planned Enhancements

- Complete and validate the SQL schema against the ER diagram.
- Expand the database to cover additional emergency room workflows where required.
- Select and implement a suitable second database paradigm, such as NoSQL or vector search.
- Develop a Next.js web interface with forms, tables, search, and filtering.
- Integrate the frontend with the database through a backend/API layer.
- Implement authentication and at least two appropriate user roles.
- Add application-level and database-level validation.
- Test database constraints, triggers, transactions, and failure scenarios.
- Document the architecture, data dictionary, test results, and application screenshots.

## 9. Security and Data Integrity

The project aims to follow basic database and application security practices:

- Use primary keys, foreign keys, and constraints to preserve data consistency.
- Use synthetic data for development and demonstrations.
- Store database credentials in environment variables rather than source code.
- Use parameterized queries and appropriate authorization in the application.
- Store passwords using secure password hashing when authentication is implemented.
- Restrict access to sensitive medical information according to user roles.

## 10. Project Documentation

The repository includes the ER diagram and relational schema files. Further documentation will cover the problem statement, objectives, scope, database design, data dictionary, implementation decisions, important queries, system architecture, testing results, and future enhancements.

## 11. Contributors

Add the names and responsibilities of both team members here.

## 12. Project Status

**Current stage:** Initial database design and SQL implementation.

The project is being developed incrementally, beginning with the relational database and progressing toward advanced database functionality, second-database integration, and a functional Next.js application.

