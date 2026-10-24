-- Advanced SQL features for Hospital Emergency Management System
-- Run after 01_schema.sql and 02_sample_data.sql.
USE hospital_emergency_management;

DROP VIEW IF EXISTS critical_emergency_cases;
DROP VIEW IF EXISTS available_hospital_beds;
DROP VIEW IF EXISTS department_staff_directory;
DROP VIEW IF EXISTS test_order_summary;
DROP VIEW IF EXISTS medicine_stock_summary;

DROP PROCEDURE IF EXISTS GetEmergencyCaseDetails;
DROP PROCEDURE IF EXISTS GetCasesForPatient;
DROP PROCEDURE IF EXISTS GetPendingBills;

DROP TRIGGER IF EXISTS prevent_negative_medicine_stock_insert;
DROP TRIGGER IF EXISTS prevent_negative_medicine_stock_update;
DROP TRIGGER IF EXISTS prevent_negative_billing_total;

DELIMITER $$

CREATE PROCEDURE GetEmergencyCaseDetails(IN p_case_id INT)
BEGIN
    SELECT
        ec.case_id,
        CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
        ec.arrival_time,
        ec.arrival_mode,
        ec.chief_complaint,
        ec.triage_level,
        ec.case_status,
        a.vehicle_number,      -- NULL for walk-in cases
        hb.bed_id,             -- NULL if no bed assigned yet
        hb.ward_type,
        hb.status AS bed_status
    FROM EMERGENCY_CASE ec
    JOIN PATIENT p ON p.patient_id = ec.patient_id
    LEFT JOIN AMBULANCE a ON a.ambulance_id = ec.ambulance_id
    LEFT JOIN HOSPITAL_BED hb ON hb.bed_id = ec.bed_id
    WHERE ec.case_id = p_case_id;
END$$

CREATE PROCEDURE GetCasesForPatient(IN p_patient_id INT)
BEGIN
    SELECT
        ec.case_id,
        ec.arrival_time,
        ec.chief_complaint,
        ec.triage_level,
        ec.case_status
    FROM EMERGENCY_CASE ec
    WHERE ec.patient_id = p_patient_id
    ORDER BY ec.arrival_time DESC;
END$$

CREATE PROCEDURE GetPendingBills()
BEGIN
    SELECT
        b.bill_id,
        b.case_id,
        CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
        b.total_amount,
        b.payment_status,
        b.payment_mode,
        b.bill_date
    FROM BILLING b
    JOIN EMERGENCY_CASE ec ON ec.case_id = b.case_id
    JOIN PATIENT p ON p.patient_id = ec.patient_id
    WHERE b.payment_status IN ('Pending', 'Partially Paid')
    ORDER BY b.bill_date;
END$$

CREATE VIEW critical_emergency_cases AS
SELECT
    ec.case_id,
    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
    ec.arrival_time,
    ec.chief_complaint,
    ec.triage_level,
    ec.case_status,
    d.dept_name AS department_name
FROM EMERGENCY_CASE ec
JOIN PATIENT p ON p.patient_id = ec.patient_id
LEFT JOIN HOSPITAL_BED hb ON hb.bed_id = ec.bed_id
LEFT JOIN DEPARTMENT d ON d.department_id = hb.department_id
WHERE ec.triage_level IN (1, 2)
  AND ec.case_status IN ('Open', 'Under Treatment', 'Admitted')$$

CREATE VIEW available_hospital_beds AS
SELECT
    hb.bed_id,
    hb.ward_type,
    hb.status,
    d.dept_name,
    d.location
FROM HOSPITAL_BED hb
JOIN DEPARTMENT d ON d.department_id = hb.department_id
WHERE hb.status = 'Available'$$

CREATE VIEW department_staff_directory AS
SELECT
    d.department_id,
    d.dept_name,
    doc.doctor_id,
    doc.name AS doctor_name,
    doc.specialization,
    doc.shift_timing AS doctor_shift,
    ns.staff_id,
    ns.name AS staff_name,
    ns.role AS staff_role,
    ns.shift_timing AS staff_shift
FROM DEPARTMENT d
LEFT JOIN DOCTOR doc ON doc.department_id = d.department_id
LEFT JOIN NURSE_STAFF ns ON ns.department_id = d.department_id$$

CREATE VIEW test_order_summary AS
SELECT
    tor.test_order_id,
    tor.case_id,
    CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
    dt.test_name,
    dt.test_type,
    dt.cost,
    doc.name AS ordered_by,
    tor.order_time,
    tor.result_status,
    tor.result_value
FROM TEST_ORDER tor
JOIN EMERGENCY_CASE ec ON ec.case_id = tor.case_id
JOIN PATIENT p ON p.patient_id = ec.patient_id
JOIN DIAGNOSTIC_TEST dt ON dt.test_id = tor.test_id
JOIN DOCTOR doc ON doc.doctor_id = tor.doctor_id$$

CREATE VIEW medicine_stock_summary AS
SELECT
    medicine_id,
    medicine_name,
    type,
    manufacturer,
    stock_quantity,
    unit_price,
    stock_quantity * unit_price AS stock_value
FROM MEDICINE$$

CREATE TRIGGER prevent_negative_medicine_stock_insert
BEFORE INSERT ON MEDICINE
FOR EACH ROW
BEGIN
    IF NEW.stock_quantity < 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Medicine stock cannot be negative';
    END IF;
END$$

CREATE TRIGGER prevent_negative_medicine_stock_update
BEFORE UPDATE ON MEDICINE
FOR EACH ROW
BEGIN
    IF NEW.stock_quantity < 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Medicine stock cannot be negative';
    END IF;
END$$

CREATE TRIGGER prevent_negative_billing_total
BEFORE INSERT ON BILLING
FOR EACH ROW
BEGIN
    IF NEW.total_amount < 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Billing total cannot be negative';
    END IF;
END$$

DELIMITER ;
