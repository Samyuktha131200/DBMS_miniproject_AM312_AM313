-- Query collection for Hospital Emergency Management System
-- Run after 01_schema.sql, 02_sample_data.sql and optionally 03_advanced_features.sql.
USE hospital_emergency_management;

-- 1. List all patients.
SELECT * FROM PATIENT ORDER BY patient_id;

-- 2. List departments and their locations.
SELECT department_id, dept_name, location
FROM DEPARTMENT
ORDER BY dept_name;

-- 3. List doctors with their departments.
SELECT doc.doctor_id, doc.name AS doctor_name, doc.specialization,
       doc.availability_status, dep.dept_name
FROM DOCTOR doc
JOIN DEPARTMENT dep ON dep.department_id = doc.department_id
ORDER BY dep.dept_name, doc.name;

-- 4. List nurse and support staff with their departments.
SELECT ns.staff_id, ns.name, ns.role, ns.shift_timing, dep.dept_name
FROM NURSE_STAFF ns
JOIN DEPARTMENT dep ON dep.department_id = ns.department_id
ORDER BY dep.dept_name, ns.name;

-- 5. List ambulance details and the patients each ambulance has transported
--    (via EMERGENCY_CASE, following the TRANSPORTS relationship).
SELECT a.ambulance_id, a.vehicle_number, a.driver_name, a.status,
       COUNT(ec.case_id) AS cases_transported,
       GROUP_CONCAT(CONCAT(p.first_name, ' ', p.last_name)
                    ORDER BY ec.arrival_time SEPARATOR ', ') AS patients_transported
FROM AMBULANCE a
LEFT JOIN EMERGENCY_CASE ec ON ec.ambulance_id = a.ambulance_id
LEFT JOIN PATIENT p ON p.patient_id = ec.patient_id
GROUP BY a.ambulance_id, a.vehicle_number, a.driver_name, a.status
ORDER BY a.ambulance_id;

-- 6. List hospital beds and their departments.
SELECT hb.bed_id, hb.ward_type, hb.status, dep.dept_name
FROM HOSPITAL_BED hb
JOIN DEPARTMENT dep ON dep.department_id = hb.department_id
ORDER BY hb.status, hb.bed_id;

-- 7. Show emergency cases with patient, ambulance and bed information.
SELECT ec.case_id, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       ec.arrival_time, ec.arrival_mode, ec.chief_complaint,
       ec.triage_level, ec.case_status, a.vehicle_number,
       hb.bed_id, hb.ward_type
FROM EMERGENCY_CASE ec
JOIN PATIENT p ON p.patient_id = ec.patient_id
LEFT JOIN AMBULANCE a ON a.ambulance_id = ec.ambulance_id   -- walk-ins have no ambulance
LEFT JOIN HOSPITAL_BED hb ON hb.bed_id = ec.bed_id
ORDER BY ec.arrival_time DESC;

-- 8. Find critical and high-priority cases that are not closed/discharged.
SELECT ec.case_id, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       ec.chief_complaint, ec.triage_level, ec.case_status, ec.arrival_time
FROM EMERGENCY_CASE ec
JOIN PATIENT p ON p.patient_id = ec.patient_id
WHERE ec.triage_level <= 2
  AND ec.case_status IN ('Open', 'Under Treatment', 'Admitted')
ORDER BY ec.triage_level, ec.arrival_time;

-- 9. Count emergency cases by status.
SELECT case_status, COUNT(*) AS case_count
FROM EMERGENCY_CASE
GROUP BY case_status
ORDER BY case_count DESC;

-- 10. Count cases by triage level.
SELECT triage_level, COUNT(*) AS case_count
FROM EMERGENCY_CASE
GROUP BY triage_level
ORDER BY triage_level;

-- 11. Count cases by arrival mode.
SELECT arrival_mode, COUNT(*) AS case_count
FROM EMERGENCY_CASE
GROUP BY arrival_mode
ORDER BY case_count DESC;

-- 12. Show treatment records with the doctor and patient.
SELECT tr.treatment_id, tr.treatment_description, tr.start_time, tr.end_time,
       doc.name AS doctor_name,
       CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       ec.case_id
FROM TREATMENT tr
JOIN DOCTOR doc ON doc.doctor_id = tr.doctor_id
JOIN EMERGENCY_CASE ec ON ec.case_id = tr.case_id
JOIN PATIENT p ON p.patient_id = ec.patient_id
ORDER BY tr.start_time DESC;

-- 13. Count treatments handled by each doctor.
SELECT doc.doctor_id, doc.name AS doctor_name, COUNT(tr.treatment_id) AS treatment_count
FROM DOCTOR doc
LEFT JOIN TREATMENT tr ON tr.doctor_id = doc.doctor_id
GROUP BY doc.doctor_id, doc.name
ORDER BY treatment_count DESC, doc.name;

-- 14. Show prescriptions with patient, doctor and medicine details.
SELECT pr.prescription_id, pr.date_issued,
       CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       doc.name AS prescribing_doctor, med.medicine_name,
       pr.dosage, pr.frequency
FROM PRESCRIPTION pr
JOIN EMERGENCY_CASE ec ON ec.case_id = pr.case_id
JOIN PATIENT p ON p.patient_id = ec.patient_id
JOIN DOCTOR doc ON doc.doctor_id = pr.doctor_id
JOIN MEDICINE med ON med.medicine_id = pr.medicine_id
ORDER BY pr.date_issued DESC;

-- 15. List medicines with stock below 60 units.
SELECT medicine_id, medicine_name, stock_quantity, unit_price
FROM MEDICINE
WHERE stock_quantity < 60
ORDER BY stock_quantity;

-- 16. Calculate the total inventory value for each medicine.
SELECT medicine_id, medicine_name, stock_quantity, unit_price,
       stock_quantity * unit_price AS stock_value
FROM MEDICINE
ORDER BY stock_value DESC;

-- 17. Show diagnostic tests and their prices.
SELECT test_id, test_name, test_type, cost
FROM DIAGNOSTIC_TEST
ORDER BY cost DESC;

-- 18. Show test orders with patient, test, ordering doctor and result status.
SELECT tor.test_order_id, tor.order_time, tor.result_status, tor.result_value,
       CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       dt.test_name, doc.name AS ordered_by
FROM TEST_ORDER tor
JOIN EMERGENCY_CASE ec ON ec.case_id = tor.case_id
JOIN PATIENT p ON p.patient_id = ec.patient_id
JOIN DIAGNOSTIC_TEST dt ON dt.test_id = tor.test_id
JOIN DOCTOR doc ON doc.doctor_id = tor.doctor_id
ORDER BY tor.order_time DESC;

-- 19. Count test orders by result status.
SELECT result_status, COUNT(*) AS order_count
FROM TEST_ORDER
GROUP BY result_status
ORDER BY order_count DESC;

-- 20. Show bills with patient and emergency case details.
SELECT b.bill_id, b.case_id,
       CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       b.total_amount, b.payment_status, b.payment_mode, b.bill_date
FROM BILLING b
JOIN EMERGENCY_CASE ec ON ec.case_id = b.case_id
JOIN PATIENT p ON p.patient_id = ec.patient_id
ORDER BY b.bill_date DESC;

-- 21. List pending or partially paid bills.
SELECT b.bill_id, b.case_id,
       CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       b.total_amount, b.payment_status
FROM BILLING b
JOIN EMERGENCY_CASE ec ON ec.case_id = b.case_id
JOIN PATIENT p ON p.patient_id = ec.patient_id
WHERE b.payment_status IN ('Pending', 'Partially Paid')
ORDER BY b.total_amount DESC;

-- 22. Calculate billed amount by payment status.
-- This is bill value grouped by status, not necessarily money already collected.
SELECT payment_status, COUNT(*) AS bill_count, SUM(total_amount) AS billed_total
FROM BILLING
GROUP BY payment_status
ORDER BY billed_total DESC;

-- 23. Find cases with a bill above the average bill amount.
SELECT b.case_id, b.bill_id, b.total_amount, b.payment_status
FROM BILLING b
WHERE b.total_amount > (SELECT AVG(total_amount) FROM BILLING)
ORDER BY b.total_amount DESC;

-- 24. Find patients who have more than one emergency case.
SELECT p.patient_id, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       COUNT(ec.case_id) AS case_count
FROM PATIENT p
JOIN EMERGENCY_CASE ec ON ec.patient_id = p.patient_id
GROUP BY p.patient_id, p.first_name, p.last_name
HAVING COUNT(ec.case_id) > 1;

-- 25. Count emergency cases by department based on the allocated bed's department.
SELECT dep.department_id, dep.dept_name, COUNT(ec.case_id) AS case_count
FROM DEPARTMENT dep
JOIN HOSPITAL_BED hb ON hb.department_id = dep.department_id
LEFT JOIN EMERGENCY_CASE ec ON ec.bed_id = hb.bed_id
GROUP BY dep.department_id, dep.dept_name
ORDER BY case_count DESC;

-- 26. Find emergency cases with diagnostic tests still pending or in progress.
SELECT ec.case_id, CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       dt.test_name, tor.result_status, tor.order_time
FROM TEST_ORDER tor
JOIN EMERGENCY_CASE ec ON ec.case_id = tor.case_id
JOIN PATIENT p ON p.patient_id = ec.patient_id
JOIN DIAGNOSTIC_TEST dt ON dt.test_id = tor.test_id
WHERE tor.result_status IN ('Ordered', 'In Progress')
ORDER BY tor.order_time;

-- 27. Show department heads.
SELECT dep.dept_name, doc.doctor_id, doc.name AS department_head
FROM DEPARTMENT dep
LEFT JOIN DOCTOR doc ON doc.doctor_id = dep.head_doctor_id
ORDER BY dep.dept_name;

-- 28. Show cases and their assigned beds whose bed status is marked available.
-- This can help identify status inconsistencies for review.
SELECT ec.case_id, hb.bed_id, hb.ward_type, hb.status AS bed_status,
       ec.case_status
FROM EMERGENCY_CASE ec
JOIN HOSPITAL_BED hb ON hb.bed_id = ec.bed_id
WHERE hb.status = 'Available';

-- ===========================================================================
-- Advanced queries (29-40). Run after 03_advanced_features.sql, which
-- creates the functions used in query 35.
-- ===========================================================================

-- 29. CORRELATED SUBQUERY: bills higher than the average bill for cases of the
-- SAME triage level. The inner query re-runs for every outer row, because it
-- uses that row's triage level (ec.triage_level).
SELECT ec.case_id, ec.triage_level, b.total_amount
FROM EMERGENCY_CASE ec
JOIN BILLING b ON b.case_id = ec.case_id
WHERE b.total_amount > (
    SELECT AVG(b2.total_amount)
    FROM BILLING b2
    JOIN EMERGENCY_CASE ec2 ON ec2.case_id = b2.case_id
    WHERE ec2.triage_level = ec.triage_level
)
ORDER BY ec.triage_level, b.total_amount DESC;

-- 30. CORRELATED NOT EXISTS: doctors who have not administered any treatment.
SELECT doc.doctor_id, doc.name, doc.specialization, doc.availability_status
FROM DOCTOR doc
WHERE NOT EXISTS (
    SELECT 1 FROM TREATMENT t WHERE t.doctor_id = doc.doctor_id
)
ORDER BY doc.doctor_id;

-- 31. CORRELATED SCALAR SUBQUERIES in the SELECT list: each patient's latest
-- arrival and how many tests were ordered across all their cases.
SELECT p.patient_id,
       CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       (SELECT MAX(ec.arrival_time) FROM EMERGENCY_CASE ec
        WHERE ec.patient_id = p.patient_id) AS latest_arrival,
       (SELECT COUNT(*) FROM TEST_ORDER tor
        JOIN EMERGENCY_CASE ec2 ON ec2.case_id = tor.case_id
        WHERE ec2.patient_id = p.patient_id) AS tests_ordered
FROM PATIENT p
ORDER BY latest_arrival DESC;

-- 32. CTE (WITH): department workload - active cases per available doctor.
WITH dept_active_cases AS (
    SELECT hb.department_id, COUNT(*) AS active_cases
    FROM EMERGENCY_CASE ec
    JOIN HOSPITAL_BED hb ON hb.bed_id = ec.bed_id
    WHERE ec.case_status IN ('Open', 'Under Treatment', 'Admitted')
    GROUP BY hb.department_id
),
dept_available_doctors AS (
    SELECT department_id, COUNT(*) AS available_doctors
    FROM DOCTOR
    WHERE availability_status <> 'Unavailable'
    GROUP BY department_id
)
SELECT d.dept_name,
       COALESCE(c.active_cases, 0) AS active_cases,
       COALESCE(a.available_doctors, 0) AS available_doctors,
       ROUND(COALESCE(c.active_cases, 0) / NULLIF(a.available_doctors, 0), 2) AS cases_per_doctor
FROM DEPARTMENT d
LEFT JOIN dept_active_cases c ON c.department_id = d.department_id
LEFT JOIN dept_available_doctors a ON a.department_id = d.department_id
ORDER BY cases_per_doctor DESC;

-- 33. RECURSIVE CTE: arrivals per hour on 24 Oct 2026, including hours with no
-- arrivals. The recursive part generates one row per hour from 08:00 to 13:00.
WITH RECURSIVE hours AS (
    SELECT CAST('2026-10-24 08:00:00' AS DATETIME) AS slot
    UNION ALL
    SELECT slot + INTERVAL 1 HOUR FROM hours
    WHERE slot < '2026-10-24 13:00:00'
)
SELECT h.slot AS hour_start,
       COUNT(ec.case_id) AS arrivals,
       COALESCE(SUM(ec.arrival_mode = 'Ambulance'), 0) AS by_ambulance
FROM hours h
LEFT JOIN EMERGENCY_CASE ec
       ON ec.arrival_time >= h.slot
      AND ec.arrival_time < h.slot + INTERVAL 1 HOUR
GROUP BY h.slot
ORDER BY h.slot;

-- 34. WINDOW FUNCTIONS: priority rank within each arrival mode (triage 1 =
-- most urgent) and a running count of arrivals through the day.
SELECT case_id, arrival_mode, triage_level, arrival_time,
       RANK() OVER (PARTITION BY arrival_mode ORDER BY triage_level) AS priority_rank,
       COUNT(*) OVER (ORDER BY arrival_time) AS arrivals_so_far
FROM EMERGENCY_CASE
ORDER BY arrival_mode, priority_rank, arrival_time;

-- 35. USER-DEFINED FUNCTIONS: age at arrival and diagnostic test cost per case,
-- next to the amount actually billed.
SELECT ec.case_id,
       CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
       fn_patient_age(p.dob, DATE(ec.arrival_time)) AS age_at_arrival,
       fn_case_test_cost(ec.case_id) AS test_cost,
       b.total_amount AS billed_amount
FROM EMERGENCY_CASE ec
JOIN PATIENT p ON p.patient_id = ec.patient_id
LEFT JOIN BILLING b ON b.case_id = ec.case_id
ORDER BY ec.case_id;

-- 36. DML IN A TRANSACTION: INSERT a test order, UPDATE its result, then
-- DELETE it, and COMMIT. The sample data is unchanged afterwards.
START TRANSACTION;
INSERT INTO TEST_ORDER (case_id, doctor_id, test_id)
VALUES (1, 2, 1);
SET @demo_order = LAST_INSERT_ID();
UPDATE TEST_ORDER
SET result_status = 'Completed', result_value = 'Normal sinus rhythm'
WHERE test_order_id = @demo_order;
SELECT * FROM TEST_ORDER WHERE test_order_id = @demo_order;
DELETE FROM TEST_ORDER WHERE test_order_id = @demo_order;
COMMIT;

-- 37. ROLLBACK: delete case 1's prescriptions, look, then undo the delete.
START TRANSACTION;
DELETE FROM PRESCRIPTION WHERE case_id = 1;
SELECT COUNT(*) AS case1_prescriptions_inside_transaction FROM PRESCRIPTION WHERE case_id = 1;
ROLLBACK;
SELECT COUNT(*) AS case1_prescriptions_after_rollback FROM PRESCRIPTION WHERE case_id = 1;

-- 38. TRIGGER CHECK: this fails with 'Medicine stock cannot be negative'.
-- UPDATE MEDICINE SET stock_quantity = -5 WHERE medicine_id = 1;

-- 39. DDL: ALTER a table to add a column, use it, then DROP it again.
ALTER TABLE MEDICINE ADD COLUMN reorder_level INT NOT NULL DEFAULT 20;
SELECT medicine_id, medicine_name, stock_quantity, reorder_level,
       stock_quantity < reorder_level AS needs_reorder
FROM MEDICINE
ORDER BY needs_reorder DESC, stock_quantity;
ALTER TABLE MEDICINE DROP COLUMN reorder_level;

-- 40. LOGIN ACCOUNTS: every doctor and nurse login and who it belongs to.
-- (password_hash is deliberately not selected.)
SELECT a.username, a.role,
       COALESCE(d.name, n.name) AS staff_name,
       dep.dept_name, a.is_active, a.last_login
FROM USER_ACCOUNT a
LEFT JOIN DOCTOR d ON d.doctor_id = a.doctor_id
LEFT JOIN NURSE_STAFF n ON n.staff_id = a.staff_id
JOIN DEPARTMENT dep ON dep.department_id = COALESCE(d.department_id, n.department_id)
ORDER BY a.role, a.username;

-- Optional advanced-feature checks (run after 03_advanced_features.sql):
-- SELECT * FROM critical_emergency_cases;
-- SELECT * FROM available_hospital_beds;
-- SELECT * FROM department_staff_directory;
-- SELECT * FROM test_order_summary;
-- SELECT * FROM medicine_stock_summary;
-- CALL GetEmergencyCaseDetails(1);
-- CALL GetCasesForPatient(1);
-- CALL GetPendingBills();
-- CALL DischargeCase(5);   -- changes data: discharges case 5, frees its bed, raises the bill if missing
-- SHOW GRANTS FOR er_nurse; -- after 05_security.sql
