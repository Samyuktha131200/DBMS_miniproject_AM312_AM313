
USE hospital_management;

-- 1. JOIN: appointments with patient and doctor details
SELECT
    p.first_name,
    p.last_name,
    d.name AS doctor_name,
    a.appointment_datetime,
    a.status
FROM appointment a
JOIN patient p ON a.patient_id = p.patient_id
JOIN doctor d ON a.doctor_id = d.doctor_id;

-- 2. GROUP BY and HAVING: departments with multiple doctors
SELECT
    dep.department_name,
    COUNT(d.doctor_id) AS doctor_count
FROM department dep
JOIN doctor d ON dep.department_id = d.department_id
GROUP BY dep.department_id, dep.department_name
HAVING COUNT(d.doctor_id) >= 1
ORDER BY doctor_count DESC;

-- 3. Subquery: patients with scheduled appointments
SELECT patient_id, first_name, last_name
FROM patient
WHERE patient_id IN (
    SELECT patient_id
    FROM appointment
    WHERE status = 'Scheduled'
);

-- 4. UPDATE: complete an appointment
UPDATE appointment
SET status = 'Completed'
WHERE appointment_id = 1;

-- 5. DELETE: remove a cancelled appointment
DELETE FROM appointment
WHERE appointment_id = 2
  AND status = 'Cancelled';

-- 6. Transaction: insert a medical record atomically
START TRANSACTION;

INSERT INTO medical_record
    (patient_id, doctor_id, appointment_id, diagnosis, treatment)
VALUES
    (1, 1, 1, 'Sample diagnosis', 'Sample treatment');

COMMIT;
