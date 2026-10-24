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

-- Optional advanced-feature checks (run after 03_advanced_features.sql):
-- SELECT * FROM critical_emergency_cases;
-- SELECT * FROM available_hospital_beds;
-- SELECT * FROM department_staff_directory;
-- SELECT * FROM test_order_summary;
-- SELECT * FROM medicine_stock_summary;
-- CALL GetEmergencyCaseDetails(1);
-- CALL GetCasesForPatient(1);
-- CALL GetPendingBills();
