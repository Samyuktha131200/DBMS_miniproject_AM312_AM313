-- Role-based access control inside MySQL
-- Run after 01-04, as root or another account that can create roles.
-- MySQL 8.0 or newer.
--
-- Three roles. Grants are per table, and per column where only some columns
-- may change, so each role gets only what it needs (least privilege):
--   er_doctor  clinical read access, records treatments / prescriptions / tests,
--              can change a case's status, triage and bed
--   er_nurse   registers patients and cases, updates case status and bed status,
--              dispenses medicine (stock only); no access to BILLING
--   er_app     the account the Next.js server should connect as: exactly the
--              statements the web app runs, plus reading USER_ACCOUNT to log in
-- No role can read or change password hashes except er_app, which can only
-- read them and update last_login. No role can DROP, ALTER or GRANT.

USE hospital_emergency_management;

DROP ROLE IF EXISTS er_doctor, er_nurse, er_app;
CREATE ROLE er_doctor, er_nurse, er_app;

-- ---------------------------------------------------------------------------
-- er_doctor
-- ---------------------------------------------------------------------------
GRANT SELECT ON hospital_emergency_management.PATIENT          TO er_doctor;
GRANT SELECT ON hospital_emergency_management.DEPARTMENT       TO er_doctor;
GRANT SELECT ON hospital_emergency_management.DOCTOR           TO er_doctor;
GRANT SELECT ON hospital_emergency_management.NURSE_STAFF      TO er_doctor;
GRANT SELECT ON hospital_emergency_management.AMBULANCE        TO er_doctor;
GRANT SELECT ON hospital_emergency_management.HOSPITAL_BED     TO er_doctor;
GRANT SELECT ON hospital_emergency_management.EMERGENCY_CASE   TO er_doctor;
GRANT SELECT ON hospital_emergency_management.MEDICINE         TO er_doctor;
GRANT SELECT ON hospital_emergency_management.DIAGNOSTIC_TEST  TO er_doctor;
GRANT SELECT ON hospital_emergency_management.BILLING          TO er_doctor;
GRANT SELECT, INSERT, UPDATE ON hospital_emergency_management.TREATMENT    TO er_doctor;
GRANT SELECT, INSERT, UPDATE ON hospital_emergency_management.PRESCRIPTION TO er_doctor;
GRANT SELECT, INSERT, UPDATE ON hospital_emergency_management.TEST_ORDER   TO er_doctor;
-- column-level: a doctor may change only these columns of a case
GRANT UPDATE (case_status, triage_level, bed_id)
    ON hospital_emergency_management.EMERGENCY_CASE TO er_doctor;
GRANT SELECT ON hospital_emergency_management.critical_emergency_cases   TO er_doctor;
GRANT SELECT ON hospital_emergency_management.available_hospital_beds    TO er_doctor;
GRANT SELECT ON hospital_emergency_management.department_staff_directory TO er_doctor;
GRANT SELECT ON hospital_emergency_management.test_order_summary         TO er_doctor;
GRANT SELECT ON hospital_emergency_management.medicine_stock_summary     TO er_doctor;
GRANT EXECUTE ON PROCEDURE hospital_emergency_management.GetEmergencyCaseDetails TO er_doctor;
GRANT EXECUTE ON PROCEDURE hospital_emergency_management.GetCasesForPatient      TO er_doctor;
GRANT EXECUTE ON PROCEDURE hospital_emergency_management.DischargeCase           TO er_doctor;
GRANT EXECUTE ON FUNCTION  hospital_emergency_management.fn_case_test_cost       TO er_doctor;
GRANT EXECUTE ON FUNCTION  hospital_emergency_management.fn_patient_age          TO er_doctor;

-- ---------------------------------------------------------------------------
-- er_nurse (no BILLING, cannot prescribe or order tests)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON hospital_emergency_management.PATIENT        TO er_nurse;
GRANT SELECT, INSERT ON hospital_emergency_management.EMERGENCY_CASE TO er_nurse;
GRANT UPDATE (case_status, bed_id)
    ON hospital_emergency_management.EMERGENCY_CASE TO er_nurse;
GRANT SELECT ON hospital_emergency_management.HOSPITAL_BED TO er_nurse;
GRANT UPDATE (status) ON hospital_emergency_management.HOSPITAL_BED TO er_nurse;
GRANT SELECT ON hospital_emergency_management.MEDICINE TO er_nurse;
GRANT UPDATE (stock_quantity) ON hospital_emergency_management.MEDICINE TO er_nurse;
GRANT SELECT ON hospital_emergency_management.DEPARTMENT      TO er_nurse;
GRANT SELECT ON hospital_emergency_management.DOCTOR          TO er_nurse;
GRANT SELECT ON hospital_emergency_management.NURSE_STAFF     TO er_nurse;
GRANT SELECT ON hospital_emergency_management.AMBULANCE       TO er_nurse;
GRANT SELECT ON hospital_emergency_management.TREATMENT       TO er_nurse;
GRANT SELECT ON hospital_emergency_management.PRESCRIPTION    TO er_nurse;
GRANT SELECT ON hospital_emergency_management.TEST_ORDER      TO er_nurse;
GRANT SELECT ON hospital_emergency_management.DIAGNOSTIC_TEST TO er_nurse;
GRANT SELECT ON hospital_emergency_management.critical_emergency_cases TO er_nurse;
GRANT SELECT ON hospital_emergency_management.available_hospital_beds  TO er_nurse;
GRANT EXECUTE ON PROCEDURE hospital_emergency_management.GetEmergencyCaseDetails TO er_nurse;
GRANT EXECUTE ON PROCEDURE hospital_emergency_management.GetCasesForPatient      TO er_nurse;

-- ---------------------------------------------------------------------------
-- er_app (the web server): reads for the dashboard, patient list, and payments;
-- inserts on the data entry and billing pages; payment updates and guarded
-- deletion of discharged, fully paid patient records.
-- UPDATE on EMERGENCY_CASE and HOSPITAL_BED is table-level because the
-- status route reads them with SELECT ... FOR UPDATE.
-- ---------------------------------------------------------------------------
GRANT SELECT ON hospital_emergency_management.PATIENT         TO er_app;
GRANT SELECT ON hospital_emergency_management.DEPARTMENT      TO er_app;
GRANT SELECT ON hospital_emergency_management.DOCTOR          TO er_app;
GRANT SELECT ON hospital_emergency_management.NURSE_STAFF     TO er_app;
GRANT SELECT ON hospital_emergency_management.AMBULANCE       TO er_app;
GRANT SELECT ON hospital_emergency_management.TREATMENT       TO er_app;
GRANT SELECT ON hospital_emergency_management.MEDICINE        TO er_app;
GRANT SELECT ON hospital_emergency_management.DIAGNOSTIC_TEST TO er_app;
GRANT SELECT ON hospital_emergency_management.PRESCRIPTION    TO er_app;
GRANT SELECT ON hospital_emergency_management.TEST_ORDER      TO er_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON hospital_emergency_management.BILLING TO er_app;
GRANT INSERT ON hospital_emergency_management.PATIENT         TO er_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON hospital_emergency_management.EMERGENCY_CASE TO er_app;
GRANT DELETE ON hospital_emergency_management.PATIENT TO er_app;
GRANT SELECT, UPDATE ON hospital_emergency_management.HOSPITAL_BED TO er_app;
GRANT SELECT ON hospital_emergency_management.USER_ACCOUNT TO er_app;
GRANT UPDATE (last_login) ON hospital_emergency_management.USER_ACCOUNT TO er_app;

-- ---------------------------------------------------------------------------
-- Users. Passwords are NOT stored in this file. To try the roles locally,
-- run these yourself with your own passwords (do not commit them):
--
--   CREATE USER 'er_app_user'@'localhost' IDENTIFIED BY '<choose a password>';
--   GRANT er_app TO 'er_app_user'@'localhost';
--   SET DEFAULT ROLE er_app TO 'er_app_user'@'localhost';
--   -- then in web/.env.local: MYSQL_USER=er_app_user, MYSQL_PASSWORD=<that password>
--
--   CREATE USER 'nurse_demo'@'localhost' IDENTIFIED BY '<choose a password>';
--   GRANT er_nurse TO 'nurse_demo'@'localhost';
--   SET DEFAULT ROLE er_nurse TO 'nurse_demo'@'localhost';
--   -- log in as nurse_demo and try: SELECT * FROM BILLING;
--   -- -> ERROR 1142: SELECT command denied to user 'nurse_demo'@'localhost' for table 'billing'
-- ---------------------------------------------------------------------------

-- Check what each role may do:
SHOW GRANTS FOR er_doctor;
SHOW GRANTS FOR er_nurse;
SHOW GRANTS FOR er_app;
