-- Existing-database migration for guarded patient deletion.
-- Run once as a MySQL user with ALTER and TRIGGER privileges.
USE hospital_emergency_management;

ALTER TABLE EMERGENCY_CASE
    DROP FOREIGN KEY fk_case_patient;

ALTER TABLE EMERGENCY_CASE
    ADD CONSTRAINT fk_case_patient FOREIGN KEY (patient_id)
        REFERENCES PATIENT(patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE BILLING
    DROP FOREIGN KEY fk_billing_case;

ALTER TABLE BILLING
    ADD CONSTRAINT fk_billing_case FOREIGN KEY (case_id)
        REFERENCES EMERGENCY_CASE(case_id)
        ON UPDATE CASCADE ON DELETE CASCADE;

DROP TRIGGER IF EXISTS guard_patient_delete;

DELIMITER $$

CREATE TRIGGER guard_patient_delete
BEFORE DELETE ON PATIENT
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM EMERGENCY_CASE
        WHERE patient_id = OLD.patient_id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Patient can be deleted only when they have discharged and paid emergency cases';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM EMERGENCY_CASE ec
        LEFT JOIN BILLING b ON b.case_id = ec.case_id
        WHERE ec.patient_id = OLD.patient_id
          AND (
              ec.case_status <> 'Discharged'
              OR b.bill_id IS NULL
              OR b.payment_status <> 'Paid'
          )
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'All patient cases must be discharged and all bills paid before deletion';
    END IF;
END$$

DELIMITER ;