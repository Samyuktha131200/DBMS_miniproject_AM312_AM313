USE hospital_emergency_management;

-- 1. Display all patients
SELECT * FROM patient;

-- 2. Display all doctors
SELECT * FROM doctor;

-- 3. Display all emergency cases
SELECT * FROM emergency_case;

-- 4. Display emergency cases with patient and doctor details
SELECT
ec.case_id,
p.patient_name,
ec.emergency_type,
ec.arrival_time,
ec.case_status,
d.doctor_name
FROM emergency_case ec
JOIN patient p ON ec.patient_id = p.patient_id
LEFT JOIN doctor d ON ec.doctor_id = d.doctor_id;

-- 5. Display emergency cases according to severity
SELECT
ec.case_id,
p.patient_name,
ec.emergency_type,
t.severity,
t.priority_level
FROM emergency_case ec
JOIN patient p ON ec.patient_id = p.patient_id
JOIN triage t ON ec.case_id = t.case_id
ORDER BY t.priority_level ASC;

-- 6. Count emergency cases by status
SELECT
case_status,
COUNT(*) AS total_cases
FROM emergency_case
GROUP BY case_status;

-- 7. Count emergency cases by emergency type
SELECT
emergency_type,
COUNT(*) AS total_cases
FROM emergency_case
GROUP BY emergency_type
ORDER BY total_cases DESC;

-- 8. Find doctors handling the most emergency cases
SELECT
d.doctor_id,
d.doctor_name,
COUNT(ec.case_id) AS total_cases
FROM doctor d
LEFT JOIN emergency_case ec ON d.doctor_id = ec.doctor_id
GROUP BY d.doctor_id, d.doctor_name
ORDER BY total_cases DESC;

-- 9. Display patients whose emergency cases are still active
SELECT DISTINCT
p.patient_id,
p.patient_name,
ec.case_id,
ec.emergency_type,
ec.case_status
FROM patient p
JOIN emergency_case ec ON p.patient_id = ec.patient_id
WHERE ec.case_status IN ('Open', 'Under Treatment', 'Admitted');

-- 10. Calculate total billing amount
SELECT
SUM(total_amount) AS total_billing_amount
FROM billing;

-- 11. Display pending and partially paid bills
SELECT
b.bill_id,
b.case_id,
p.patient_name,
b.total_amount,
b.payment_status
FROM billing b
JOIN emergency_case ec ON b.case_id = ec.case_id
JOIN patient p ON ec.patient_id = p.patient_id
WHERE b.payment_status IN ('Pending', 'Partially Paid');

-- 12. Calculate total revenue by payment status
SELECT
payment_status,
COUNT(*) AS number_of_bills,
SUM(total_amount) AS total_amount
FROM billing
GROUP BY payment_status;

-- 13. Display available beds
SELECT *
FROM bed
WHERE bed_status = 'Available';

-- 14. Count beds by type and status
SELECT
bed_type,
bed_status,
COUNT(*) AS total_beds
FROM bed
GROUP BY bed_type, bed_status
ORDER BY bed_type, bed_status;

-- 15. Display medicines with low stock
SELECT
medicine_id,
medicine_name,
stock_quantity
FROM medicine
WHERE stock_quantity < 50
ORDER BY stock_quantity ASC;

-- 16. Find the total quantity of each medicine used
SELECT
m.medicine_id,
m.medicine_name,
SUM(tm.quantity) AS total_quantity_used
FROM medicine m
JOIN treatment_medicine tm ON m.medicine_id = tm.medicine_id
GROUP BY m.medicine_id, m.medicine_name
ORDER BY total_quantity_used DESC;

-- 17. Display diagnostic tests and their status
SELECT
ec.case_id,
p.patient_name,
dt.test_name,
dt.test_status,
dt.test_cost
FROM diagnostic_test dt
JOIN emergency_case ec ON dt.case_id = ec.case_id
JOIN patient p ON ec.patient_id = p.patient_id
ORDER BY ec.case_id;

-- 18. Find cases with billing above the average bill amount
SELECT
case_id,
total_amount
FROM billing
WHERE total_amount > (
SELECT AVG(total_amount)
FROM billing
);

-- 19. Find the most expensive diagnostic test
SELECT
test_name,
test_cost
FROM diagnostic_test
WHERE test_cost = (
SELECT MAX(test_cost)
FROM diagnostic_test
);

-- 20. Display treatments and the doctors responsible
SELECT
t.treatment_id,
t.case_id,
d.doctor_name,
t.diagnosis,
t.treatment_status,
t.treatment_date
FROM treatment t
JOIN doctor d ON t.doctor_id = d.doctor_id
ORDER BY t.treatment_date DESC;
