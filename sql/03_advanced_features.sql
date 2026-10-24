DELIMITER $$

CREATE PROCEDURE GetEmergencyCaseDetails(IN p_case_id INT)
BEGIN
SELECT
ec.case_id,
p.patient_name,
ec.emergency_type,
ec.arrival_time,
ec.case_status,
d.doctor_name,
t.severity,
t.priority_level
FROM emergency_case ec
JOIN patient p ON ec.patient_id = p.patient_id
LEFT JOIN doctor d ON ec.doctor_id = d.doctor_id
LEFT JOIN triage t ON ec.case_id = t.case_id
WHERE ec.case_id = p_case_id;
END$$

CREATE PROCEDURE GetPendingBills()
BEGIN
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
END$$

CREATE VIEW emergency_case_overview AS
SELECT
ec.case_id,
p.patient_name,
ec.emergency_type,
ec.arrival_time,
ec.case_status,
d.doctor_name,
t.severity,
t.priority_level
FROM emergency_case ec
JOIN patient p ON ec.patient_id = p.patient_id
LEFT JOIN doctor d ON ec.doctor_id = d.doctor_id
LEFT JOIN triage t ON ec.case_id = t.case_id$$

CREATE VIEW available_beds AS
SELECT
bed_id,
bed_number,
bed_type,
location
FROM bed
WHERE bed_status = 'Available'$$

CREATE VIEW medicine_stock AS
SELECT
medicine_id,
medicine_name,
stock_quantity,
unit_price,
expiry_date
FROM medicine
WHERE stock_quantity > 0$$

CREATE TRIGGER prevent_negative_medicine_stock
BEFORE UPDATE ON medicine
FOR EACH ROW
BEGIN
IF NEW.stock_quantity < 0 THEN
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'Medicine stock cannot be negative';
END IF;
END$$

CREATE TRIGGER prevent_negative_medicine_quantity
BEFORE INSERT ON treatment_medicine
FOR EACH ROW
BEGIN
IF NEW.quantity <= 0 THEN
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'Medicine quantity must be greater than zero';
END IF;
END$$

DELIMITER ;
