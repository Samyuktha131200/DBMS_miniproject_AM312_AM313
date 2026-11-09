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
DROP TRIGGER IF EXISTS check_bed_before_case_insert;
DROP TRIGGER IF EXISTS check_bed_before_case_update;
DROP TRIGGER IF EXISTS sync_bed_after_case_insert;
DROP TRIGGER IF EXISTS sync_bed_after_case_update;

DROP PROCEDURE IF EXISTS DischargeCase;
DROP FUNCTION IF EXISTS fn_case_test_cost;
DROP FUNCTION IF EXISTS fn_patient_age;

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


-- ---------------------------------------------------------------------------
-- User-defined functions
-- ---------------------------------------------------------------------------

-- Total cost of the diagnostic tests ordered for a case (cancelled tests excluded).
-- Used by DischargeCase to raise the bill, and in 04_queries.sql.
CREATE FUNCTION fn_case_test_cost(p_case_id INT)
RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(10,2);
    SELECT COALESCE(SUM(dt.cost), 0) INTO v_total
    FROM TEST_ORDER tor
    JOIN DIAGNOSTIC_TEST dt ON dt.test_id = tor.test_id
    WHERE tor.case_id = p_case_id
      AND tor.result_status <> 'Cancelled';
    RETURN v_total;
END$$

-- A patient's age in whole years on a given date.
CREATE FUNCTION fn_patient_age(p_dob DATE, p_on DATE)
RETURNS INT
DETERMINISTIC
NO SQL
BEGIN
    RETURN TIMESTAMPDIFF(YEAR, p_dob, p_on);
END$$

-- ---------------------------------------------------------------------------
-- Triggers that keep beds consistent with emergency cases
-- ---------------------------------------------------------------------------

-- A case cannot be put in a bed that is under maintenance.
CREATE TRIGGER check_bed_before_case_insert
BEFORE INSERT ON EMERGENCY_CASE
FOR EACH ROW
BEGIN
    IF NEW.bed_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM HOSPITAL_BED
        WHERE bed_id = NEW.bed_id AND status = 'Maintenance'
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot assign a bed that is under maintenance';
    END IF;
END$$

CREATE TRIGGER check_bed_before_case_update
BEFORE UPDATE ON EMERGENCY_CASE
FOR EACH ROW
BEGIN
    IF NEW.bed_id IS NOT NULL
       AND NOT (NEW.bed_id <=> OLD.bed_id)
       AND EXISTS (
           SELECT 1 FROM HOSPITAL_BED
           WHERE bed_id = NEW.bed_id AND status = 'Maintenance'
       ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot assign a bed that is under maintenance';
    END IF;
END$$

-- A new active case with a bed marks that bed Occupied.
CREATE TRIGGER sync_bed_after_case_insert
AFTER INSERT ON EMERGENCY_CASE
FOR EACH ROW
BEGIN
    IF NEW.bed_id IS NOT NULL
       AND NEW.case_status IN ('Open', 'Under Treatment', 'Admitted') THEN
        UPDATE HOSPITAL_BED SET status = 'Occupied'
        WHERE bed_id = NEW.bed_id AND status = 'Available';
    END IF;
END$$

-- When a case is given a bed, moves bed, or is discharged/closed, update the beds:
-- the new bed becomes Occupied, and the old bed becomes Available again
-- unless another active case is still using it.
CREATE TRIGGER sync_bed_after_case_update
AFTER UPDATE ON EMERGENCY_CASE
FOR EACH ROW
BEGIN
    DECLARE v_new_active BOOLEAN;
    DECLARE v_old_active BOOLEAN;
    SET v_new_active = NEW.case_status IN ('Open', 'Under Treatment', 'Admitted');
    SET v_old_active = OLD.case_status IN ('Open', 'Under Treatment', 'Admitted');

    IF NEW.bed_id IS NOT NULL AND v_new_active
       AND (NOT (NEW.bed_id <=> OLD.bed_id) OR NOT v_old_active) THEN
        UPDATE HOSPITAL_BED SET status = 'Occupied'
        WHERE bed_id = NEW.bed_id AND status = 'Available';
    END IF;

    IF OLD.bed_id IS NOT NULL AND v_old_active
       AND (NOT (NEW.bed_id <=> OLD.bed_id) OR NOT v_new_active)
       AND NOT EXISTS (
           SELECT 1 FROM EMERGENCY_CASE ec
           WHERE ec.bed_id = OLD.bed_id
             AND ec.case_id <> OLD.case_id
             AND ec.case_status IN ('Open', 'Under Treatment', 'Admitted')
       ) THEN
        UPDATE HOSPITAL_BED SET status = 'Available'
        WHERE bed_id = OLD.bed_id AND status = 'Occupied';
    END IF;
END$$

-- ---------------------------------------------------------------------------
-- Stored procedure with a transaction
-- ---------------------------------------------------------------------------

-- Discharge a case as ONE unit of work:
--   1. mark the case Discharged (the trigger above frees its bed)
--   2. end any treatment still running
--   3. cancel tests that were ordered but never started
--   4. raise a Pending bill from fn_case_test_cost if the case has none
-- If any step fails, the handler rolls everything back (atomicity).
-- Example: CALL DischargeCase(5);
CREATE PROCEDURE DischargeCase(IN p_case_id INT)
BEGIN
    DECLARE v_status VARCHAR(30) DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT case_status INTO v_status
    FROM EMERGENCY_CASE
    WHERE case_id = p_case_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Emergency case not found';
    END IF;
    IF v_status IN ('Discharged', 'Closed') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Case is already discharged or closed';
    END IF;

    UPDATE EMERGENCY_CASE SET case_status = 'Discharged' WHERE case_id = p_case_id;

    UPDATE TREATMENT SET end_time = GREATEST(NOW(), start_time)
    WHERE case_id = p_case_id AND end_time IS NULL;

    UPDATE TEST_ORDER SET result_status = 'Cancelled'
    WHERE case_id = p_case_id AND result_status = 'Ordered';

    INSERT INTO BILLING (case_id, total_amount, payment_status)
    SELECT p_case_id, fn_case_test_cost(p_case_id), 'Pending'
    FROM DUAL
    WHERE NOT EXISTS (SELECT 1 FROM BILLING WHERE case_id = p_case_id);

    COMMIT;

    SELECT ec.case_id, ec.case_status, ec.bed_id,
           hb.status AS bed_status, b.total_amount, b.payment_status
    FROM EMERGENCY_CASE ec
    LEFT JOIN HOSPITAL_BED hb ON hb.bed_id = ec.bed_id
    LEFT JOIN BILLING b ON b.case_id = ec.case_id
    WHERE ec.case_id = p_case_id;
END$$

DELIMITER ;
